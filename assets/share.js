/* ============================================================
   学习报告的分享编码
   ------------------------------------------------------------
   ★ 目标：一个链接就是一份报告，不需要服务器、不需要建仓库、
     不往任何地方写数据。链接本身就是全部内容。

   ★ 链接形态
       https://cool-zimo.github.io/math-cn/#r/R1c.<一长串>
     或
       https://cool-zimo.github.io/math-cn/r/R1c.<一长串>

     前缀 R1c = 第 1 版 + deflate 压缩；R1p = 第 1 版 + 未压缩（降级）

   ★ 为什么用 deflate-raw 而不是 gzip：
     gzip 要多 18 字节的头尾，对本来就短的 payload 是浪费。

   ★ 为什么带校验位：
     链接在微信/QQ 里会被转义、被截断、被加上尾巴。
     没有校验的话，被截断的链接会渲染出一份"看起来对但其实少了数据"的报告
     —— 那比直接报错危险得多。所以宁可报"链接不完整"，也不能半对半错。
   ============================================================ */
(function (global) {
    'use strict';

    var VER = 'R1';
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

    function bytesToB64url(u8) {
        var out = '';
        for (var i = 0; i < u8.length; i += 3) {
            var b0 = u8[i], b1 = u8[i + 1], b2 = u8[i + 2];
            out += B64[b0 >> 2];
            out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
            if (b1 === undefined) break;
            out += B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
            if (b2 === undefined) break;
            out += B64[b2 & 63];
        }
        return out;
    }

    function b64urlToBytes(s) {
        var rev = {};
        for (var i = 0; i < B64.length; i++) rev[B64[i]] = i;
        var out = [];
        for (var j = 0; j < s.length; j += 4) {
            var c0 = rev[s[j]], c1 = rev[s[j + 1]], c2 = rev[s[j + 2]], c3 = rev[s[j + 3]];
            if (c0 === undefined || c1 === undefined) break;
            out.push((c0 << 2) | (c1 >> 4));
            if (c2 === undefined) break;
            out.push(((c1 & 15) << 4) | (c2 >> 2));
            if (c3 === undefined) break;
            out.push(((c2 & 3) << 6) | c3);
        }
        return new Uint8Array(out);
    }

    // 简单校验：把 payload 每个字符的 charCode 累加取模。
    // 不防伪造（没必要），只防"传输中被截断/转义坏掉"。
    function sum(s) {
        var h = 7;
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        return (h % 46656).toString(36);
    }

    function noop() {}

    /* ★ stream writer 的 rejection 必须自己吃掉。
     *   早期版本没接管 w.write() 的 promise，一旦数据损坏，
     *   它就变成 unhandled rejection —— 浏览器里的表现是
     *   「点了链接，什么都没发生」，连句报错都没有。
     *   这比报错糟糕得多：用户以为网站坏了。
     *   所以两个 promise 都要 catch，哪怕什么都不做。 */
    function deflate(bytes) {
        if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
        var cs, w;
        try { cs = new CompressionStream('deflate-raw'); w = cs.writable.getWriter(); }
        catch (e) { return Promise.resolve(null); }
        var wp = w.write(bytes).then(function () { return w.close(); }).catch(noop);
        return new Response(cs.readable).arrayBuffer().catch(function () { return null; })
            .then(function (b) {
                return wp.then(function () { return b && new Uint8Array(b); },
                               function () { return null; });
            });
    }

    /* 返回 null = 数据解压不了（多半是链接被截断）。
     * 不支持解压是另一回事，由下面 decode 里单独判断并给出不同提示 ——
     * 「你的浏览器太旧」和「链接坏了」是两种问题，不能混成一句。 */
    function inflate(bytes) {
        if (typeof DecompressionStream === 'undefined') return Promise.resolve(null);
        var ds, w;
        try { ds = new DecompressionStream('deflate-raw'); w = ds.writable.getWriter(); }
        catch (e) { return Promise.resolve(null); }
        var wp = w.write(bytes).then(function () { return w.close(); }).catch(noop);
        return new Response(ds.readable).arrayBuffer().catch(function () { return null; })
            .then(function (b) {
                return wp.then(function () { return b && new Uint8Array(b); },
                               function () { return null; });
            });
    }

    /* ---------- 编码 ----------
     * rep: {
     *   subject, grade, chapter, mode, ts, asked,
     *   states: { <topicId>: 'M'|'S'|'W'|'U' },   // 只放非 mastered 的 + 少量 mastered
     *   masteredCount: n,
     *   targets: [ids]
     * }
     * 只存 id 与状态，不存题目和答案文本 —— 报告页只做展示，
     * 需要姓名/描述等富信息时再加载题库补全。这样链接能短一个数量级。
     */
    function encode(rep) {
        var ids = Object.keys(rep.states || {});
        var d = ids.map(function (id) { return id + rep.states[id]; }).join(',');
        var payload = [
            VER.slice(1),
            rep.subject || '',
            rep.grade || '',
            rep.chapter || '',
            rep.mode || 'target',
            (rep.ts || Date.now()).toString(36),
            rep.asked || 0,
            rep.masteredCount || 0,
            (rep.targets || []).join('!'),
            d
        ].join('~');

        var raw = new TextEncoder().encode(sum(payload) + '.' + payload);
        return deflate(raw).then(function (z) {
            if (z && z.length < raw.length) return VER + 'c.' + bytesToB64url(z);
            return VER + 'p.' + bytesToB64url(raw);   // 压不动就不压，别为了压而压
        });
    }

    /* 错误分类：给 UI 用，不同 kind 给不同的可操作提示。
     * 「格式不对」和「被截断」对用户的意义完全不同 ——
     *   前者是"你点错了"，后者是"链接是好的但没复制全"。 */
    function shareError(message, kind) {
        var e = new Error(message);
        e.kind = kind || 'corrupt';
        return e;
    }

    /* 聊天软件会往链接后面挂东西：?from=singlemessage、&isappinstalled=0、
     * 中文或英文标点（转发时对方加的句号/括号/逗号）、复制时带上的空格。
     * 报告码只可能是 base64url 字符，遇到这些一律当尾巴切掉。 */
    function cleanCode(str) {
        return String(str == null ? '' : str)
            .trim()
            // base64url 只可能是 [A-Za-z0-9_-]，所以 ? & # 一定是尾巴，从第一个起全切
            .replace(/[?&#].*$/, '')
            .replace(/[，。、；：,）】》”’！\s]+$/, '');  // 中英文标点尾巴
    }

    /* ★★ 关键：decode 必须【永远】返回 promise，绝不能同步 throw。
     *
     *   以前这里是同步 throw('链接格式不对')，而调用方写的是
     *     ShareCode.decode(code).then(...).catch(...)
     *   —— 同步抛出时 .then 根本没机会挂上，catch 自然接不住，
     *     错误一路冒泡到 init()，被显示成「题库加载失败：链接格式不对」。
     *   既掩盖了真实原因，还误导用户去查网络（离线也必然复现）。
     *
     *   所以外层包一个已 resolved 的 promise：
     *   同步 throw 一律转成 rejection，调用方的 .catch 才接得住。 */
    function decode(str) {
        return Promise.resolve().then(function () { return decodeSync(str); });
    }

    function decodeSync(str) {
        str = cleanCode(str);
        if (!str) throw shareError('链接里没有报告码', 'format');
        var m = /^(R1)([cp])\.(.+)$/.exec(str);
        if (!m) throw shareError('这不像一个报告链接', 'format');
        if (!/^[A-Za-z0-9_-]+$/.test(m[3])) {
            throw shareError('链接里有非法字符，可能在转发时被转义了', 'corrupt');
        }
        var body = b64urlToBytes(m[3]);

        function parse(u8) {
            var s = new TextDecoder().decode(u8);
            var dot = s.indexOf('.');
            if (dot < 0) throw shareError('链接内容损坏', 'corrupt');
            var mac = s.slice(0, dot), payload = s.slice(dot + 1);
            // ★ 校验位对不上 = 链接被截断或被转义坏了。
            //   这时"猜着解析"会出一份缺数据的报告，宁可直接报错。
            if (sum(payload) !== mac) throw shareError('链接不完整，可能被聊天软件截断', 'truncated');
            var f = payload.split('~');
            if (f.length < 10) throw shareError('链接内容损坏', 'corrupt');
            var states = {};
            if (f[9]) {
                f[9].split(',').forEach(function (kv) {
                    if (kv.length < 2) return;
                    states[kv.slice(0, -1)] = kv.slice(-1);
                });
            }
            return {
                subject: f[1], grade: f[2], chapter: f[3], mode: f[4],
                ts: parseInt(f[5], 36) || 0,
                asked: parseInt(f[6], 10) || 0,
                masteredCount: parseInt(f[7], 10) || 0,
                targets: f[8] ? f[8].split('!') : [],
                states: states
            };
        }

        // 不压缩分支：parse 本身会同步 throw，但整个 decodeSync
        // 已经跑在 promise 里了，同步 throw 会被转成 rejection，安全。
        if (m[2] === 'p') return parse(body);
        if (typeof DecompressionStream === 'undefined') {
            throw shareError('当前浏览器不支持解压，请更新浏览器', 'unsupported');
        }
        return inflate(body).then(function (u8) {
            // 解压不出来 ≠ 浏览器不行。能到这一步说明 API 是有的，
            // 那就是数据本身坏了 —— 别把「链接被截断」说成「你浏览器太旧」。
            if (!u8) throw shareError('链接内容损坏，可能被聊天软件截断或转义', 'truncated');
            return parse(u8);
        });
    }

    function url(code, pathMode) {
        var base = location.origin + location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '');
        return pathMode ? base + '/r/' + code : base + '/#r/' + code;
    }

    /* 从当前地址里取报告码：支持 #r/xxx 和 /r/xxx 两种形态 */
    function fromLocation() {
        var h = location.hash || '';
        var m = /^#r\/(.+)$/.exec(h);
        if (m) return m[1];
        var pm = /(?:^|\/)r\/(R1[cp]\.[\w-]+)/.exec(location.pathname);
        if (pm) return pm[1];
        return null;
    }

    global.ShareCode = { encode: encode, decode: decode, url: url, fromLocation: fromLocation };
})(window);
