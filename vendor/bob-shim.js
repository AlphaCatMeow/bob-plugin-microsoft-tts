/**
 * Bob 运行时 Web API 适配层。
 *
 * Bob 插件运行在 JavaScriptCore 环境中，缺少部分 Web 标准 API。
 * 本文件检测当前 runtime（Bob / Node / 其他），按需将缺失的 API 注入到 globalThis，
 * 使项目代码无需关心运行时差异。
 *
 * 注入的 API：
 *   - fetch（基于 Bob $http）
 *   - crypto.randomUUID / crypto.subtle.importKey + sign
 *   - atob / btoa
 *   - TextEncoder
 *   - setTimeout / clearTimeout
 *   - console
 *
 * 设计原则：
 *   1. 只补齐缺失的 API，已存在的一律不动
 *   2. 所有实现尽量小，便于代码审计
 */

var nativeUtils = {
    stringifyValue: function (value) {
        if (typeof value === 'string') return value;
        try { return JSON.stringify(value); } catch (_) { return String(value); }
    },
};

// --- HMAC-SHA256 -----------------------------------------------------------
// Bob 没有 crypto.subtle，这里基于 TS 编译后的 sha256Bytes（通过 globalThis 桥接）扩展出 HMAC。
function hmacSha256Bytes(keyBytes, dataBytes) {
    var sha256Bytes = globalThis.__sha256Bytes;
    var blockSize = 64;
    var key = keyBytes.slice();
    if (key.length > blockSize) {
        key = sha256Bytes(key);
    }
    while (key.length < blockSize) {
        key.push(0);
    }
    var oKeyPad = new Array(blockSize);
    var iKeyPad = new Array(blockSize);
    for (var i = 0; i < blockSize; i++) {
        oKeyPad[i] = key[i] ^ 0x5c;
        iKeyPad[i] = key[i] ^ 0x36;
    }
    var inner = sha256Bytes(iKeyPad.concat(dataBytes));
    return sha256Bytes(oKeyPad.concat(inner));
}

// --- base64 ----------------------------------------------------------------
var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function btoaImpl(str) {
    var out = '';
    var i = 0;
    while (i < str.length) {
        var c1 = str.charCodeAt(i++) & 0xff;
        var c2 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
        var c3 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
        var e1 = c1 >> 2;
        var e2 = ((c1 & 3) << 4) | ((isNaN(c2) ? 0 : c2) >> 4);
        var e3 = isNaN(c2) ? 64 : (((c2 & 15) << 2) | ((isNaN(c3) ? 0 : c3) >> 6));
        var e4 = isNaN(c3) ? 64 : (c3 & 63);
        out += B64.charAt(e1) + B64.charAt(e2)
             + (e3 === 64 ? '=' : B64.charAt(e3))
             + (e4 === 64 ? '=' : B64.charAt(e4));
    }
    return out;
}

function atobImpl(b64) {
    // 兼容 base64url：JWT payload 用 base64url 编码（`-_` 替代 `+/`，可能无 padding）。
    // 上游 wangwangit/tts 中 `JSON.parse(atob(jwt))` 必须在此处理，否则 JWT 含 `-_` 时
    // 解码字节会缺失，JSON.parse 报 "Unexpected EOF"。
    b64 = String(b64).replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    var out = '';
    var buffer = 0;
    var bits = 0;
    for (var i = 0; i < b64.length; i++) {
        var idx = B64.indexOf(b64.charAt(i));
        if (idx < 0) {
            continue;
        }
        buffer = (buffer << 6) | idx;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }
    return out;
}

// --- TextEncoder -----------------------------------------------------------
function TextEncoderImpl() {}
TextEncoderImpl.prototype.encode = function (str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code < 0x80) {
            out.push(code);
        } else if (code < 0x800) {
            out.push(0xc0 | (code >> 6));
            out.push(0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
            // 代理对
            var lo = str.charCodeAt(++i);
            var cp = 0x10000 + (((code - 0xd800) << 10) | (lo - 0xdc00));
            out.push(0xf0 | (cp >> 18));
            out.push(0x80 | ((cp >> 12) & 0x3f));
            out.push(0x80 | ((cp >> 6) & 0x3f));
            out.push(0x80 | (cp & 0x3f));
        } else {
            out.push(0xe0 | (code >> 12));
            out.push(0x80 | ((code >> 6) & 0x3f));
            out.push(0x80 | (code & 0x3f));
        }
    }
    // 返回类 Uint8Array：上游用 length / Array.prototype.slice 都能工作
    var arr = out.slice();
    arr.buffer = arr;
    return arr;
};

// --- crypto.subtle ---------------------------------------------------------
function subtleImportKey(format, key, algo, extractable, usages) {
    // 只支持 raw HMAC 用法（vendor 唯一调用方式）
    var bytes = key;
    if (typeof key === 'string') {
        bytes = [];
        for (var i = 0; i < key.length; i++) {
            bytes.push(key.charCodeAt(i) & 0xff);
        }
    } else if (key && typeof key.length === 'number') {
        bytes = Array.prototype.slice.call(key);
    }
    return Promise.resolve({ _shimKey: bytes, _algo: algo });
}

function subtleSign(algo, key, data) {
    if (!key || !key._shimKey) {
        return Promise.reject(new Error('shim subtle.sign: 仅支持本 shim 颁发的 key'));
    }
    var dataBytes;
    if (typeof data === 'string') {
        dataBytes = [];
        for (var i = 0; i < data.length; i++) {
            dataBytes.push(data.charCodeAt(i) & 0xff);
        }
    } else if (data && typeof data.length === 'number') {
        dataBytes = Array.prototype.slice.call(data);
    } else {
        dataBytes = [];
    }
    var sig = hmacSha256Bytes(key._shimKey, dataBytes);
    // 上游用 new Uint8Array(signature) 包一层；返回普通数组即可
    return Promise.resolve(sig);
}

// --- fetch（基于 Bob $http） ------------------------------------------------
function bobBytesToString(bytes) {
    var s = '';
    var arr = Array.prototype.slice.call(bytes);
    for (var i = 0; i < arr.length; i++) {
        s += String.fromCharCode(arr[i] & 0xff);
    }
    return s;
}

function bobResponse(resp) {
    var statusCode = resp.response && resp.response.statusCode != null
        ? resp.response.statusCode
        : (resp.statusCode != null ? resp.statusCode : 0);

    // Bob `$http.request` 的 handler 收到的 resp 结构在不同 Bob 版本/不同 Content-Type 下字段略有差异：
    //   - `application/json` 响应：resp.data 一般已被 Bob 自动 JSON.parse 成对象
    //   - `text/*` 响应：resp.data 是字符串
    //   - 二进制响应（audio/*）：resp.data 是 $data 对象或字节数组，且通常同时填 resp.rawData
    // 这里把所有可能的字段都尝试一遍，最大程度兼容。
    var rawBytes = pickBytes(resp);
    var data = resp.data;

    function asText() {
        if (typeof data === 'string') return data;
        if (data && typeof data === 'object' && !isBytesLike(data) && rawBytes == null) {
            try { return JSON.stringify(data); } catch (_) { return ''; }
        }
        if (rawBytes) return bobBytesToString(rawBytes);
        return '';
    }

    function asJson() {
        // Bob 已经 parse 过的对象（且不是字节数组）直接返回
        if (data && typeof data === 'object' && !isBytesLike(data)) {
            return data;
        }
        var text = asText();
        if (!text) {
            throw new Error('HTTP ' + statusCode + ' 响应体为空，无法解析 JSON');
        }
        return JSON.parse(text);
    }

    function asBytes() {
        if (rawBytes) return Array.prototype.slice.call(rawBytes);
        if (isBytesLike(data)) return Array.prototype.slice.call(data);
        if (typeof data === 'string') {
            var arr = [];
            for (var i = 0; i < data.length; i++) arr.push(data.charCodeAt(i) & 0xff);
            return arr;
        }
        return [];
    }

    var respHeaders = {};
    if (resp.response && resp.response.headers) {
        respHeaders = resp.response.headers;
    }

    return {
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        headers: {
            get: function (name) {
                if (!name) return null;
                var lower = name.toLowerCase();
                var keys = Object.keys(respHeaders);
                for (var i = 0; i < keys.length; i++) {
                    if (keys[i].toLowerCase() === lower) {
                        return respHeaders[keys[i]];
                    }
                }
                return null;
            },
        },
        _rawResp: resp,
        text: function () {
            var t = asText();
            if (!t && statusCode) return Promise.resolve('<HTTP ' + statusCode + ' 无响应体>');
            return Promise.resolve(t);
        },
        json: function () {
            try {
                return Promise.resolve(asJson());
            } catch (err) {
                return Promise.reject(err);
            }
        },
        blob: function () {
            var arr = asBytes();
            return Promise.resolve({ _shimBlob: true, bytes: arr, size: arr.length });
        },
        arrayBuffer: function () {
            return Promise.resolve(asBytes());
        },
    };
}

function isBytesLike(value) {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return true;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return true;
    // Uint8Array / 类数组：有 length 且 0..length-1 都是 number
    if (typeof value.length === 'number' && value.length >= 0
        && (value.length === 0 || typeof value[0] === 'number')) {
        return true;
    }
    return false;
}

function pickBytes(resp) {
    if (!resp) return null;
    if (resp.rawData != null) {
        // Bob 的 $data 对象：有 toByteArray()；Buffer/Uint8Array 直接 length 可用
        if (resp.rawData.toByteArray) return resp.rawData.toByteArray();
        if (resp.rawData.length != null) return resp.rawData;
    }
    if (resp.bodyBytes != null) return resp.bodyBytes;
    // 兜底：data 本身就是字节数组（Bob 在二进制响应下常见）
    if (resp.data && typeof resp.data !== 'string') {
        if (resp.data.toByteArray) return resp.data.toByteArray();
        if (Array.isArray(resp.data)) return resp.data;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(resp.data)) return resp.data;
        // Uint8Array 等
        if (typeof resp.data.length === 'number' && resp.data.length > 0
            && typeof resp.data[0] === 'number'
            && !(resp.data.constructor && resp.data.constructor.name === 'Object')) {
            return resp.data;
        }
    }
    return null;
}

function bobFetch(url, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
        try {
            var body = options.body;

            // 标准 fetch 语义：字符串 body 直接发送，不做任何自动编码。
            // Bob $http.request 对字符串 body 会按 Content-Type 自动编码（JSON/form），
            // 这与标准 fetch 行为不一致。统一转为 $data 类型，让 Bob 直接发送原始字节。
            if (typeof body === 'string' && body.length > 0) {
                if (typeof $data !== 'undefined' && $data && $data.fromUTF8) {
                    body = $data.fromUTF8(body);
                } else if (typeof $data !== 'undefined' && $data && $data.fromByteArray) {
                    var arr = [];
                    for (var i = 0; i < body.length; i++) arr.push(body.charCodeAt(i) & 0xff);
                    body = $data.fromByteArray(arr);
                }
            }

            $http.request({
                method: options.method || 'GET',
                url: url,
                header: options.headers || {},
                body: body,
                timeout: 30,
                handler: function (resp) {
                    var hasStatus = resp && resp.response && resp.response.statusCode != null;
                    if (resp && resp.error && !hasStatus) {
                        reject(new Error('网络错误：' + nativeUtils.stringifyValue(resp.error)));
                        return;
                    }
                    resolve(bobResponse(resp || {}));
                },
            });
        } catch (err) {
            reject(err);
        }
    });
}

// --- 安装到 globalThis ------------------------------------------------------
(function installShim() {
    var g = (typeof globalThis !== 'undefined') ? globalThis
        : (typeof global !== 'undefined') ? global
        : (typeof window !== 'undefined') ? window
        : this;

    // atob / btoa：强制覆盖。
    // 原因：上游 wangwangit 用 atob 解 JWT（base64url），而 Node/浏览器原生 atob 仅接标准 base64，
    // 含 `-_` 时行为不一致（Node 抛错，部分 runtime 默默丢字节）。统一走 shim 实现确保跨 runtime 行为一致。
    g.atob = atobImpl;
    if (typeof g.btoa === 'undefined') {
        g.btoa = btoaImpl;
    }
    if (typeof g.TextEncoder === 'undefined') {
        g.TextEncoder = TextEncoderImpl;
    }
    if (typeof g.crypto === 'undefined' || typeof g.crypto.subtle === 'undefined') {
        var existing = g.crypto || {};
        var subtle = existing.subtle || { importKey: subtleImportKey, sign: subtleSign };
        g.crypto = {
            randomUUID: existing.randomUUID,
            subtle: subtle,
            getRandomValues: existing.getRandomValues,
        };
    }
    if (typeof g.fetch === 'undefined' && typeof $http !== 'undefined') {
        g.fetch = bobFetch;
    }
    if (typeof g.setTimeout === 'undefined') {
        var _nextTimerId = 1;
        var _activeTimers = {};
        g.setTimeout = function (fn, ms) {
            var id = _nextTimerId++;
            _activeTimers[id] = true;
            var callback = function () {
                if (_activeTimers[id]) {
                    delete _activeTimers[id];
                    try { fn(); } catch (_) {}
                }
            };
            if (typeof $task !== 'undefined' && $task.delay) {
                $task.delay((ms || 0) / 1000, callback);
            }
            return id;
        };
        g.clearTimeout = function (id) {
            if (id != null && id !== 0) {
                delete _activeTimers[id];
            }
        };
    }
    if (typeof g.console === 'undefined') {
        g.console = {
            log: function () { if (typeof $log !== 'undefined' && $log.info) $log.info(Array.prototype.join.call(arguments, ' ')); },
            error: function () { if (typeof $log !== 'undefined' && $log.error) $log.error(Array.prototype.join.call(arguments, ' ')); },
        };
    }
})();
