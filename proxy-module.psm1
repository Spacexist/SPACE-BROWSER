Set-StrictMode -Version 2

$script:Utf8 = New-Object Text.UTF8Encoding($false)
$script:CookieJar = New-Object Net.CookieContainer
$script:ProxyRoute = '/proxy?url='
$script:DefaultUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
$script:ModuleVersion = 'free-canvas-proxy-v5'

function New-ProxyResult {
    param(
        [int]$StatusCode,
        [string]$Reason,
        [string]$ContentType,
        [byte[]]$Body
    )

    [PSCustomObject]@{
        StatusCode = $StatusCode
        Reason = $Reason
        ContentType = $ContentType
        Body = $Body
    }
}

function Get-ProxyModuleVersion {
    $script:ModuleVersion
}

function Get-ProxyTargetUrl {
    param([string]$RequestTarget)

    if ([string]::IsNullOrWhiteSpace($RequestTarget)) {
        return ''
    }

    $match = [regex]::Match($RequestTarget, '(?i)(?:\?|&)url=([^&]*)')
    if (-not $match.Success) {
        return ''
    }

    [Uri]::UnescapeDataString($match.Groups[1].Value)
}

function Get-ProxyReferrerUrl {
    param([string]$RequestTarget)

    if ([string]::IsNullOrWhiteSpace($RequestTarget)) {
        return ''
    }

    $match = [regex]::Match($RequestTarget, '(?i)(?:\?|&)ref=([^&]*)')
    if (-not $match.Success) {
        return ''
    }

    [Uri]::UnescapeDataString($match.Groups[1].Value)
}
function Get-RequestHeader {
    param(
        [hashtable]$Headers,
        [string]$Name,
        [string]$Fallback = ''
    )

    if ($Headers -and $Headers.ContainsKey($Name.ToLowerInvariant())) {
        return [string]$Headers[$Name.ToLowerInvariant()]
    }
    $Fallback
}

function ConvertTo-ProxyUrl {
    param(
        [string]$Value,
        [Uri]$BaseUri
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $Value
    }

    $trimmed = $Value.Trim()
    if ($trimmed.StartsWith('#') -or
        $trimmed -match '^(?i:javascript:|data:|blob:|mailto:|tel:|about:)') {
        return $Value
    }

    $absolute = $null
    if (-not [Uri]::TryCreate($BaseUri, $trimmed, [ref]$absolute)) {
        return $Value
    }
    if ($absolute.Scheme -ne 'http' -and $absolute.Scheme -ne 'https') {
        return $Value
    }

    $script:ProxyRoute + [Uri]::EscapeDataString($absolute.AbsoluteUri) + '&ref=' + [Uri]::EscapeDataString($BaseUri.AbsoluteUri)
}

function Get-RemoteEncoding {
    param([Net.HttpWebResponse]$Response)

    if (-not [string]::IsNullOrWhiteSpace($Response.CharacterSet)) {
        try {
            return [Text.Encoding]::GetEncoding($Response.CharacterSet.Trim().Trim('"'))
        }
        catch {
        }
    }
    $script:Utf8
}

function Rewrite-CssForProxy {
    param(
        [string]$Css,
        [Uri]$BaseUri
    )

    $urlPattern = '(?is)url\(\s*(?<quote>["'']?)(?<value>[^)"'']+)\k<quote>\s*\)'
    $urlEvaluator = [Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $value = $match.Groups['value'].Value.Trim()
        $proxied = ConvertTo-ProxyUrl -Value $value -BaseUri $BaseUri
        "url('$proxied')"
    }
    $Css = [regex]::Replace($Css, $urlPattern, $urlEvaluator)

    $importPattern = '(?is)(?<prefix>@import\s+)(?<quote>["''])(?<value>.*?)\k<quote>'
    $importEvaluator = [Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $proxied = ConvertTo-ProxyUrl -Value $match.Groups['value'].Value -BaseUri $BaseUri
        $match.Groups['prefix'].Value + '"' + $proxied + '"'
    }
    [regex]::Replace($Css, $importPattern, $importEvaluator)
}

function Rewrite-HtmlForProxy {
    param(
        [string]$Html,
        [Uri]$BaseUri
    )

    # Response headers are not forwarded, but CSP meta tags can still block the rewritten page.
    $cspPattern = '(?is)<meta\b(?=[^>]*http-equiv\s*=\s*["'']?\s*Content-Security-Policy\b)[^>]*>'
    $Html = [regex]::Replace($Html, $cspPattern, '')
    $Html = [regex]::Replace($Html, '(?is)<base\b[^>]*>', '')

    # Rewrite static navigations and subresources before the browser parses the document.
    $attributePattern = '(?is)(?<prefix>\b(?:src|href|poster|action|formaction)\s*=\s*)(?<quote>["''])(?<value>.*?)\k<quote>'
    $attributeEvaluator = [Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $proxied = ConvertTo-ProxyUrl -Value $match.Groups['value'].Value -BaseUri $BaseUri
        $match.Groups['prefix'].Value + $match.Groups['quote'].Value + $proxied + $match.Groups['quote'].Value
    }
    $Html = [regex]::Replace($Html, $attributePattern, $attributeEvaluator)

    $baseJson = ConvertTo-Json $BaseUri.AbsoluteUri -Compress
    $bootstrap = @"
<script data-free-canvas-proxy>
(() => {
  const remoteBase = $baseJson;
  const proxyPrefix = location.origin + '/proxy?url=';
  const throughProxy = value => {
    try {
      const text = String(value);
      const localUrl = new URL(text, location.href);
      if (localUrl.origin === location.origin && localUrl.pathname === '/proxy') return localUrl.href;
      const url = new URL(text, remoteBase);
      if (!/^https?:$/.test(url.protocol)) return value;
      return proxyPrefix + encodeURIComponent(url.href) + '&ref=' + encodeURIComponent(remoteBase);
    } catch (_) { return value; }
  };
  window.__freeCanvasProxyUrl = throughProxy;
  const resourceAttributes = {
    SCRIPT: ['src'], LINK: ['href'], IMG: ['src'], IFRAME: ['src'], SOURCE: ['src'],
    VIDEO: ['src', 'poster'], AUDIO: ['src'], TRACK: ['src'], EMBED: ['src'],
    OBJECT: ['data'], INPUT: ['src']
  };
  const shouldProxyResourceAttribute = (element, name) => {
    const names = element && resourceAttributes[element.tagName];
    return !!names && names.includes(String(name).toLowerCase());
  };
  const nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const nextValue = shouldProxyResourceAttribute(this, name) ? throughProxy(value) : value;
    return nativeSetAttribute.call(this, name, nextValue);
  };
  const patchUrlProperty = (constructor, name) => {
    if (!constructor) return;
    const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, name);
    if (!descriptor || !descriptor.get || !descriptor.set || descriptor.configurable === false) return;
    Object.defineProperty(constructor.prototype, name, {
      ...descriptor,
      set(value) { return descriptor.set.call(this, throughProxy(value)); }
    });
  };
  for (const [constructor, name] of [
    [window.HTMLScriptElement, 'src'], [window.HTMLLinkElement, 'href'],
    [window.HTMLImageElement, 'src'], [window.HTMLIFrameElement, 'src'],
    [window.HTMLSourceElement, 'src'], [window.HTMLMediaElement, 'src'],
    [window.HTMLVideoElement, 'poster'], [window.HTMLTrackElement, 'src'],
    [window.HTMLEmbedElement, 'src'], [window.HTMLObjectElement, 'data'],
    [window.HTMLInputElement, 'src']
  ]) patchUrlProperty(constructor, name);
  const rewritePendingResource = node => {
    if (!node || node.nodeType !== 1) return;
    const rewriteOne = element => {
      for (const name of resourceAttributes[element.tagName] || []) {
        if (element.hasAttribute(name)) nativeSetAttribute.call(element, name, throughProxy(element.getAttribute(name)));
      }
    };
    rewriteOne(node);
    if (node.querySelectorAll) node.querySelectorAll('script[src],link[href],img[src],iframe[src],source[src],video[src],video[poster],audio[src],track[src],embed[src],object[data],input[src]').forEach(rewriteOne);
  };
  for (const method of ['appendChild', 'insertBefore', 'replaceChild']) {
    const nativeMethod = Node.prototype[method];
    Node.prototype[method] = function(node, ...rest) {
      rewritePendingResource(node);
      return nativeMethod.call(this, node, ...rest);
    };
  }

  const originalFetch = window.fetch && window.fetch.bind(window);
  if (originalFetch) window.fetch = (input, init) => {
    const method = String((init && init.method) || (input instanceof Request && input.method) || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return originalFetch(input, init);
    if (input instanceof Request) return originalFetch(new Request(throughProxy(input.url), input), init);
    return originalFetch(throughProxy(String(input)), init);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    const verb = String(method || 'GET').toUpperCase();
    return originalOpen.call(this, method, verb === 'GET' || verb === 'HEAD' ? throughProxy(url) : url, ...rest);
  };

  try {
    for (const method of ['assign', 'replace']) {
      const original = Location.prototype[method];
      if (typeof original === 'function') {
        Location.prototype[method] = function(url) { return original.call(this, throughProxy(url)); };
      }
    }
  } catch (_) {}

  const originalWindowOpen = window.open && window.open.bind(window);
  if (originalWindowOpen) window.open = (url, target, features) => originalWindowOpen(throughProxy(url), target, features);

  const navigateForm = (form, submitter) => {
    const method = String((submitter && submitter.formMethod) || form.method || 'GET').toUpperCase();
    if (method !== 'GET') return false;
    const action = (submitter && submitter.formAction) || form.action || remoteBase;
    const target = new URL(action, remoteBase);
    try {
      for (const [name, value] of new FormData(form).entries()) {
        if (typeof value === 'string') target.searchParams.append(name, value);
      }
    } catch (_) {}
    location.href = throughProxy(target.href);
    return true;
  };

  document.addEventListener('submit', event => {
    if (navigateForm(event.target, event.submitter)) event.preventDefault();
  }, true);

  try {
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
      if (!navigateForm(this, null)) return nativeSubmit.call(this);
    };
  } catch (_) {}

  document.addEventListener('click', event => {
    const link = event.target.closest && event.target.closest('a[href]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || /^(javascript:|mailto:|tel:)/i.test(href)) return;
    event.preventDefault();
    if (link.target === '_blank') window.open(throughProxy(link.href), '_blank');
    else location.href = throughProxy(link.href);
  }, true);

  const rewriteElement = element => {
    if (!element || element.nodeType !== 1 || element.tagName === 'BASE') return;
    for (const name of ['src', 'href', 'poster', 'action', 'formaction']) {
      if (element.hasAttribute && element.hasAttribute(name)) {
        const current = element.getAttribute(name);
        const rewritten = throughProxy(current);
        if (rewritten !== current) element.setAttribute(name, rewritten);
      }
    }
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') rewriteElement(record.target);
      for (const node of record.addedNodes || []) {
        rewriteElement(node);
        if (node.querySelectorAll) node.querySelectorAll('[src],[href],[poster],[action],[formaction]').forEach(rewriteElement);
      }
    }
  }).observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeFilter: ['src','href','poster','action','formaction']});
})();
</script>
"@

    $head = [regex]::Match($Html, '(?is)<head\b[^>]*>')
    if ($head.Success) {
        return $Html.Insert($head.Index + $head.Length, $bootstrap)
    }
    $bootstrap + $Html
}

function New-ProxyErrorResult {
    param(
        [string]$TargetUrl,
        [string]$Message
    )

    $safeUrl = [Net.WebUtility]::HtmlEncode($TargetUrl)
    $safeMessage = [Net.WebUtility]::HtmlEncode($Message)
    $html = "<!doctype html><html lang='zh-CN'><meta charset='utf-8'><title>网页代理加载失败</title><style>body{margin:0;padding:40px;background:#f5f5f5;color:#222;font:15px/1.7 system-ui,sans-serif}main{max-width:760px;margin:auto;background:white;border:1px solid #ddd;border-radius:14px;padding:28px}code{word-break:break-all;color:#a33}</style><main><h2>网页加载失败</h2><p>代理无法读取目标地址：</p><code>$safeUrl</code><p>$safeMessage</p><p>需要登录、验证码或特殊网络环境的网站仍可能拒绝代理访问。</p></main></html>"
    New-ProxyResult 502 'Bad Gateway' 'text/html; charset=utf-8' $script:Utf8.GetBytes($html)
}

function Invoke-UrlProxy {
    param(
        [Parameter(Mandatory=$true)][string]$TargetUrl,
        [ValidateSet('GET','HEAD')][string]$Method = 'GET',
        [hashtable]$RequestHeaders = @{},
        [string]$ReferrerUrl = ''
    )

    $targetUri = $null
    if (-not [Uri]::TryCreate($TargetUrl, [UriKind]::Absolute, [ref]$targetUri) -or
        ($targetUri.Scheme -ne 'http' -and $targetUri.Scheme -ne 'https')) {
        return New-ProxyErrorResult $TargetUrl 'Only absolute HTTP or HTTPS URLs are supported.'
    }

    $response = $null
    try {
        $request = [Net.HttpWebRequest]::Create($targetUri)
        $request.Method = $Method
        $request.AllowAutoRedirect = $true
        $request.MaximumAutomaticRedirections = 10
        $request.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
        $request.Timeout = 25000
        $request.ReadWriteTimeout = 25000
        $request.CookieContainer = $script:CookieJar
        $request.UserAgent = Get-RequestHeader $RequestHeaders 'user-agent' $script:DefaultUserAgent
        $request.Accept = Get-RequestHeader $RequestHeaders 'accept' 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/png,*/*;q=0.8'
        $request.Headers.Add('Accept-Language', (Get-RequestHeader $RequestHeaders 'accept-language' 'zh-CN,zh;q=0.9,en;q=0.8'))
        $request.Headers.Add('Cache-Control', 'no-cache')
        $request.Headers.Add('Pragma', 'no-cache')
        $referrerUri = $null
        if (-not [string]::IsNullOrWhiteSpace($ReferrerUrl) -and
            [Uri]::TryCreate($ReferrerUrl, [UriKind]::Absolute, [ref]$referrerUri) -and
            ($referrerUri.Scheme -eq 'http' -or $referrerUri.Scheme -eq 'https')) {
            $request.Referer = $referrerUri.AbsoluteUri
        }

        try {
            $response = [Net.HttpWebResponse]$request.GetResponse()
        }
        catch [Net.WebException] {
            if ($_.Exception.Response) {
                $response = [Net.HttpWebResponse]$_.Exception.Response
            }
            else {
                throw
            }
        }

        $contentType = $response.ContentType
        if ([string]::IsNullOrWhiteSpace($contentType)) {
            $contentType = 'application/octet-stream'
        }

        $memory = New-Object IO.MemoryStream
        try {
            if ($Method -ne 'HEAD') {
                $remoteStream = $response.GetResponseStream()
                try {
                    $remoteStream.CopyTo($memory)
                }
                finally {
                    $remoteStream.Dispose()
                }
            }
            $body = $memory.ToArray()
        }
        finally {
            $memory.Dispose()
        }

        if ($Method -ne 'HEAD' -and
            ($contentType.StartsWith('text/html', [StringComparison]::OrdinalIgnoreCase) -or
             $contentType.StartsWith('text/css', [StringComparison]::OrdinalIgnoreCase))) {
            $encoding = Get-RemoteEncoding $response
            $text = $encoding.GetString($body)
            if ($contentType.StartsWith('text/html', [StringComparison]::OrdinalIgnoreCase)) {
                $text = Rewrite-HtmlForProxy -Html $text -BaseUri $response.ResponseUri
                $contentType = 'text/html; charset=utf-8'
            }
            else {
                $text = Rewrite-CssForProxy -Css $text -BaseUri $response.ResponseUri
                $contentType = 'text/css; charset=utf-8'
            }
            $body = $script:Utf8.GetBytes($text)
        }

        $status = [int]$response.StatusCode
        $reason = if ([string]::IsNullOrWhiteSpace($response.StatusDescription)) { 'OK' } else { $response.StatusDescription }
        New-ProxyResult $status $reason $contentType $body
    }
    catch {
        $message = $_.Exception.Message
        if ($_.Exception.InnerException) { $message = $_.Exception.InnerException.Message }
        New-ProxyErrorResult $TargetUrl $message
    }
    finally {
        if ($response) { $response.Dispose() }
    }
}

Export-ModuleMember -Function Get-ProxyModuleVersion, Get-ProxyTargetUrl, Get-ProxyReferrerUrl, Invoke-UrlProxy