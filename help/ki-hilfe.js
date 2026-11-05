"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // node_modules/@noble/curves/node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber(n, title = "") {
    if (!Number.isSafeInteger(n) || n < 0) {
      const prefix = title && `"${title}" `;
      throw new Error(`${prefix}expected integer >= 0, got ${n}`);
    }
  }
  function abytes(value, length, title = "") {
    const bytes2 = isBytes(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes2 || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes2 ? `length=${len}` : `type=${typeof value}`;
      throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
    }
    return value;
  }
  var hasHexBuiltin = /* @__PURE__ */ (() => (
    // @ts-ignore
    typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function"
  ))();
  var hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
  function bytesToHex(bytes2) {
    abytes(bytes2);
    if (hasHexBuiltin)
      return bytes2.toHex();
    let hex = "";
    for (let i = 0; i < bytes2.length; i++) {
      hex += hexes[bytes2[i]];
    }
    return hex;
  }
  var asciis = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
  function asciiToBase16(ch) {
    if (ch >= asciis._0 && ch <= asciis._9)
      return ch - asciis._0;
    if (ch >= asciis.A && ch <= asciis.F)
      return ch - (asciis.A - 10);
    if (ch >= asciis.a && ch <= asciis.f)
      return ch - (asciis.a - 10);
    return;
  }
  function hexToBytes(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    if (hasHexBuiltin)
      return Uint8Array.fromHex(hex);
    const hl = hex.length;
    const al = hl / 2;
    if (hl % 2)
      throw new Error("hex string expected, got unpadded hex of length " + hl);
    const array = new Uint8Array(al);
    for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
      const n1 = asciiToBase16(hex.charCodeAt(hi));
      const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
      if (n1 === void 0 || n2 === void 0) {
        const char = hex[hi] + hex[hi + 1];
        throw new Error('hex string expected, got non-hex character "' + char + '" at index ' + hi);
      }
      array[ai] = n1 * 16 + n2;
    }
    return array;
  }
  function randomBytes(bytesLength = 32) {
    const cr = typeof globalThis === "object" ? globalThis.crypto : null;
    if (typeof cr?.getRandomValues !== "function")
      throw new Error("crypto.getRandomValues must be defined");
    return cr.getRandomValues(new Uint8Array(bytesLength));
  }

  // node_modules/@noble/curves/utils.js
  var _0n = /* @__PURE__ */ BigInt(0);
  function abignumber(n) {
    if (typeof n === "bigint") {
      if (!isPosBig(n))
        throw new Error("positive bigint expected, got " + n);
    } else
      anumber(n);
    return n;
  }
  function hexToNumber(hex) {
    if (typeof hex !== "string")
      throw new Error("hex string expected, got " + typeof hex);
    return hex === "" ? _0n : BigInt("0x" + hex);
  }
  function bytesToNumberLE(bytes2) {
    return hexToNumber(bytesToHex(copyBytes(abytes(bytes2)).reverse()));
  }
  function numberToBytesBE(n, len) {
    anumber(len);
    n = abignumber(n);
    const res = hexToBytes(n.toString(16).padStart(len * 2, "0"));
    if (res.length !== len)
      throw new Error("number too large");
    return res;
  }
  function numberToBytesLE(n, len) {
    return numberToBytesBE(n, len).reverse();
  }
  function copyBytes(bytes2) {
    return Uint8Array.from(bytes2);
  }
  var isPosBig = (n) => typeof n === "bigint" && _0n <= n;
  function inRange(n, min, max) {
    return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
  }
  function aInRange(title, n, min, max) {
    if (!inRange(n, min, max))
      throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
  }
  function validateObject(object, fields = {}, optFields = {}) {
    if (!object || typeof object !== "object")
      throw new Error("expected valid options object");
    function checkField(fieldName, expectedType, isOpt) {
      const val = object[fieldName];
      if (isOpt && val === void 0)
        return;
      const current = typeof val;
      if (current !== expectedType || val === null)
        throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
    }
    const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
    iter(fields, false);
    iter(optFields, true);
  }

  // node_modules/@noble/curves/abstract/modular.js
  var _0n2 = /* @__PURE__ */ BigInt(0);
  function mod(a, b) {
    const result = a % b;
    return result >= _0n2 ? result : b + result;
  }
  function pow2(x, power, modulo) {
    let res = x;
    while (power-- > _0n2) {
      res *= res;
      res %= modulo;
    }
    return res;
  }

  // node_modules/@noble/curves/abstract/curve.js
  function createKeygen(randomSecretKey, getPublicKey) {
    return function keygen(seed) {
      const secretKey = randomSecretKey(seed);
      return { secretKey, publicKey: getPublicKey(secretKey) };
    };
  }

  // node_modules/@noble/curves/abstract/montgomery.js
  var _0n3 = BigInt(0);
  var _1n = BigInt(1);
  var _2n = BigInt(2);
  function validateOpts(curve) {
    validateObject(curve, {
      adjustScalarBytes: "function",
      powPminus2: "function"
    });
    return Object.freeze({ ...curve });
  }
  function montgomery(curveDef) {
    const CURVE = validateOpts(curveDef);
    const { P, type, adjustScalarBytes: adjustScalarBytes2, powPminus2, randomBytes: rand } = CURVE;
    const is25519 = type === "x25519";
    if (!is25519 && type !== "x448")
      throw new Error("invalid type");
    const randomBytes_ = rand || randomBytes;
    const montgomeryBits = is25519 ? 255 : 448;
    const fieldLen = is25519 ? 32 : 56;
    const Gu = is25519 ? BigInt(9) : BigInt(5);
    const a24 = is25519 ? BigInt(121665) : BigInt(39081);
    const minScalar = is25519 ? _2n ** BigInt(254) : _2n ** BigInt(447);
    const maxAdded = is25519 ? BigInt(8) * _2n ** BigInt(251) - _1n : BigInt(4) * _2n ** BigInt(445) - _1n;
    const maxScalar = minScalar + maxAdded + _1n;
    const modP = (n) => mod(n, P);
    const GuBytes = encodeU(Gu);
    function encodeU(u) {
      return numberToBytesLE(modP(u), fieldLen);
    }
    function decodeU(u) {
      const _u = copyBytes(abytes(u, fieldLen, "uCoordinate"));
      if (is25519)
        _u[31] &= 127;
      return modP(bytesToNumberLE(_u));
    }
    function decodeScalar(scalar) {
      return bytesToNumberLE(adjustScalarBytes2(copyBytes(abytes(scalar, fieldLen, "scalar"))));
    }
    function scalarMult(scalar, u) {
      const pu = montgomeryLadder(decodeU(u), decodeScalar(scalar));
      if (pu === _0n3)
        throw new Error("invalid private or public key received");
      return encodeU(pu);
    }
    function scalarMultBase(scalar) {
      return scalarMult(scalar, GuBytes);
    }
    const getPublicKey = scalarMultBase;
    const getSharedSecret = scalarMult;
    function cswap(swap, x_2, x_3) {
      const dummy = modP(swap * (x_2 - x_3));
      x_2 = modP(x_2 - dummy);
      x_3 = modP(x_3 + dummy);
      return { x_2, x_3 };
    }
    function montgomeryLadder(u, scalar) {
      aInRange("u", u, _0n3, P);
      aInRange("scalar", scalar, minScalar, maxScalar);
      const k = scalar;
      const x_1 = u;
      let x_2 = _1n;
      let z_2 = _0n3;
      let x_3 = u;
      let z_3 = _1n;
      let swap = _0n3;
      for (let t = BigInt(montgomeryBits - 1); t >= _0n3; t--) {
        const k_t = k >> t & _1n;
        swap ^= k_t;
        ({ x_2, x_3 } = cswap(swap, x_2, x_3));
        ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
        swap = k_t;
        const A = x_2 + z_2;
        const AA = modP(A * A);
        const B = x_2 - z_2;
        const BB = modP(B * B);
        const E = AA - BB;
        const C = x_3 + z_3;
        const D = x_3 - z_3;
        const DA = modP(D * A);
        const CB = modP(C * B);
        const dacb = DA + CB;
        const da_cb = DA - CB;
        x_3 = modP(dacb * dacb);
        z_3 = modP(x_1 * modP(da_cb * da_cb));
        x_2 = modP(AA * BB);
        z_2 = modP(E * (AA + modP(a24 * E)));
      }
      ({ x_2, x_3 } = cswap(swap, x_2, x_3));
      ({ x_2: z_2, x_3: z_3 } = cswap(swap, z_2, z_3));
      const z2 = powPminus2(z_2);
      return modP(x_2 * z2);
    }
    const lengths = {
      secretKey: fieldLen,
      publicKey: fieldLen,
      seed: fieldLen
    };
    const randomSecretKey = (seed = randomBytes_(fieldLen)) => {
      abytes(seed, lengths.seed, "seed");
      return seed;
    };
    const utils = { randomSecretKey };
    return Object.freeze({
      keygen: createKeygen(randomSecretKey, getPublicKey),
      getSharedSecret,
      getPublicKey,
      scalarMult,
      scalarMultBase,
      utils,
      GuBytes: GuBytes.slice(),
      lengths
    });
  }

  // node_modules/@noble/curves/ed25519.js
  var _1n2 = BigInt(1);
  var _2n2 = BigInt(2);
  var _3n = /* @__PURE__ */ BigInt(3);
  var _5n = BigInt(5);
  var _8n = BigInt(8);
  var ed25519_CURVE_p = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffed");
  function ed25519_pow_2_252_3(x) {
    const _10n = BigInt(10), _20n = BigInt(20), _40n = BigInt(40), _80n = BigInt(80);
    const P = ed25519_CURVE_p;
    const x2 = x * x % P;
    const b2 = x2 * x % P;
    const b4 = pow2(b2, _2n2, P) * b2 % P;
    const b5 = pow2(b4, _1n2, P) * x % P;
    const b10 = pow2(b5, _5n, P) * b5 % P;
    const b20 = pow2(b10, _10n, P) * b10 % P;
    const b40 = pow2(b20, _20n, P) * b20 % P;
    const b80 = pow2(b40, _40n, P) * b40 % P;
    const b160 = pow2(b80, _80n, P) * b80 % P;
    const b240 = pow2(b160, _80n, P) * b80 % P;
    const b250 = pow2(b240, _10n, P) * b10 % P;
    const pow_p_5_8 = pow2(b250, _2n2, P) * x % P;
    return { pow_p_5_8, b2 };
  }
  function adjustScalarBytes(bytes2) {
    bytes2[0] &= 248;
    bytes2[31] &= 127;
    bytes2[31] |= 64;
    return bytes2;
  }
  var x25519 = /* @__PURE__ */ (() => {
    const P = ed25519_CURVE_p;
    return montgomery({
      P,
      type: "x25519",
      powPminus2: (x) => {
        const { pow_p_5_8, b2 } = ed25519_pow_2_252_3(x);
        return mod(pow2(pow_p_5_8, _3n, P) * b2, P);
      },
      adjustScalarBytes
    });
  })();

  // node_modules/@noble/hashes/esm/utils.js
  function isBytes2(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber2(n) {
    if (!Number.isSafeInteger(n) || n < 0)
      throw new Error("positive integer expected, got " + n);
  }
  function abytes2(b, ...lengths) {
    if (!isBytes2(b))
      throw new Error("Uint8Array expected");
    if (lengths.length > 0 && !lengths.includes(b.length))
      throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new Error("Hash should be wrapped by utils.createHasher");
    anumber2(h.outputLen);
    anumber2(h.blockLen);
  }
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput(out, instance) {
    abytes2(out);
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error("digestInto() expects output buffer of length at least " + min);
    }
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new Error("string expected");
    return new Uint8Array(new TextEncoder().encode(str));
  }
  function toBytes(data) {
    if (typeof data === "string")
      data = utf8ToBytes(data);
    abytes2(data);
    return data;
  }
  var Hash = class {
  };
  function createHasher(hashCons) {
    const hashC = (msg2) => hashCons().update(toBytes(msg2)).digest();
    const tmp = hashCons();
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = () => hashCons();
    return hashC;
  }

  // node_modules/@noble/hashes/esm/hmac.js
  var HMAC = class extends Hash {
    constructor(hash, _key) {
      super();
      this.finished = false;
      this.destroyed = false;
      ahash(hash);
      const key = toBytes(_key);
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function")
        throw new Error("Expected instance of class which extends utils.Hash");
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      abytes2(out, this.outputLen);
      this.finished = true;
      this.iHash.digestInto(out);
      this.oHash.update(out);
      this.oHash.digestInto(out);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to || (to = Object.create(Object.getPrototypeOf(this), {}));
      const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.oHash = oHash._cloneInto(to.oHash);
      to.iHash = iHash._cloneInto(to.iHash);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  };
  var hmac = (hash, key, message) => new HMAC(hash, key).update(message).digest();
  hmac.create = (hash, key) => new HMAC(hash, key);

  // node_modules/@noble/hashes/esm/hkdf.js
  function extract(hash, ikm, salt) {
    ahash(hash);
    if (salt === void 0)
      salt = new Uint8Array(hash.outputLen);
    return hmac(hash, toBytes(salt), toBytes(ikm));
  }
  var HKDF_COUNTER = /* @__PURE__ */ Uint8Array.from([0]);
  var EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
  function expand(hash, prk, info, length = 32) {
    ahash(hash);
    anumber2(length);
    const olen = hash.outputLen;
    if (length > 255 * olen)
      throw new Error("Length should be <= 255*HashLen");
    const blocks = Math.ceil(length / olen);
    if (info === void 0)
      info = EMPTY_BUFFER;
    const okm = new Uint8Array(blocks * olen);
    const HMAC2 = hmac.create(hash, prk);
    const HMACTmp = HMAC2._cloneInto();
    const T = new Uint8Array(HMAC2.outputLen);
    for (let counter = 0; counter < blocks; counter++) {
      HKDF_COUNTER[0] = counter + 1;
      HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
      okm.set(T, olen * counter);
      HMAC2._cloneInto(HMACTmp);
    }
    HMAC2.destroy();
    HMACTmp.destroy();
    clean(T, HKDF_COUNTER);
    return okm.slice(0, length);
  }
  var hkdf = (hash, ikm, salt, info, length) => expand(hash, extract(hash, ikm, salt), info, length);

  // node_modules/@noble/hashes/esm/_md.js
  function setBigUint64(view, byteOffset, value, isLE2) {
    if (typeof view.setBigUint64 === "function")
      return view.setBigUint64(byteOffset, value, isLE2);
    const _32n2 = BigInt(32);
    const _u32_max = BigInt(4294967295);
    const wh = Number(value >> _32n2 & _u32_max);
    const wl = Number(value & _u32_max);
    const h = isLE2 ? 4 : 0;
    const l = isLE2 ? 0 : 4;
    view.setUint32(byteOffset + h, wh, isLE2);
    view.setUint32(byteOffset + l, wl, isLE2);
  }
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD = class extends Hash {
    constructor(blockLen, outputLen, padOffset, isLE2) {
      super();
      this.finished = false;
      this.length = 0;
      this.pos = 0;
      this.destroyed = false;
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE2;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      data = toBytes(data);
      abytes2(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          continue;
        }
        buffer.set(data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
        }
      }
      this.length += data.length;
      this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE: isLE2 } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      clean(this.buffer.subarray(pos));
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        pos = 0;
      }
      for (let i = pos; i < blockLen; i++)
        buffer[i] = 0;
      setBigUint64(view, blockLen - 8, BigInt(this.length * 8), isLE2);
      this.process(view, 0);
      const oview = createView(out);
      const len = this.outputLen;
      if (len % 4)
        throw new Error("_sha2: outputLen should be aligned to 32bit");
      const outLen = len / 4;
      const state = this.get();
      if (outLen > state.length)
        throw new Error("_sha2: outputLen bigger than state");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE2);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneInto(to) {
      to || (to = new this.constructor());
      to.set(...this.get());
      const { blockLen, buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (length % blockLen)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);

  // node_modules/@noble/hashes/esm/sha2.js
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
  var SHA256 = class extends HashMD {
    constructor(outputLen = 32) {
      super(64, outputLen, 8, false);
      this.A = SHA256_IV[0] | 0;
      this.B = SHA256_IV[1] | 0;
      this.C = SHA256_IV[2] | 0;
      this.D = SHA256_IV[3] | 0;
      this.E = SHA256_IV[4] | 0;
      this.F = SHA256_IV[5] | 0;
      this.G = SHA256_IV[6] | 0;
      this.H = SHA256_IV[7] | 0;
    }
    get() {
      const { A, B, C, D, E, F: F2, G, H } = this;
      return [A, B, C, D, E, F2, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F2, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F2 | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16; i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A, B, C, D, E, F: F2, G, H } = this;
      for (let i = 0; i < 64; i++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F2, G) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F2;
        F2 = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F2 = F2 + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F2, G, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean(this.buffer);
    }
  };
  var sha256 = /* @__PURE__ */ createHasher(() => new SHA256());

  // node_modules/@noble/hashes/esm/sha256.js
  var sha2562 = sha256;

  // node_modules/@noble/post-quantum/node_modules/@noble/hashes/_u64.js
  var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
  var _32n = /* @__PURE__ */ BigInt(32);
  function fromBig(n, le = false) {
    if (le)
      return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
    return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
  }
  function split(lst, le = false) {
    const len = lst.length;
    let Ah = new Uint32Array(len);
    let Al = new Uint32Array(len);
    for (let i = 0; i < len; i++) {
      const { h, l } = fromBig(lst[i], le);
      [Ah[i], Al[i]] = [h, l];
    }
    return [Ah, Al];
  }
  var rotlSH = (h, l, s) => h << s | l >>> 32 - s;
  var rotlSL = (h, l, s) => l << s | h >>> 32 - s;
  var rotlBH = (h, l, s) => l << s - 32 | h >>> 64 - s;
  var rotlBL = (h, l, s) => h << s - 32 | l >>> 64 - s;

  // node_modules/@noble/post-quantum/node_modules/@noble/hashes/utils.js
  function isBytes3(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
  }
  function anumber3(n, title = "") {
    if (!Number.isSafeInteger(n) || n < 0) {
      const prefix = title && `"${title}" `;
      throw new Error(`${prefix}expected integer >= 0, got ${n}`);
    }
  }
  function abytes3(value, length, title = "") {
    const bytes2 = isBytes3(value);
    const len = value?.length;
    const needsLen = length !== void 0;
    if (!bytes2 || needsLen && len !== length) {
      const prefix = title && `"${title}" `;
      const ofLen = needsLen ? ` of length ${length}` : "";
      const got = bytes2 ? `length=${len}` : `type=${typeof value}`;
      throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
    }
    return value;
  }
  function aexists2(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("Hash instance has been destroyed");
    if (checkFinished && instance.finished)
      throw new Error("Hash#digest() has already been called");
  }
  function aoutput2(out, instance) {
    abytes3(out, void 0, "digestInto() output");
    const min = instance.outputLen;
    if (out.length < min) {
      throw new Error('"digestInto() output" expected to be of length >=' + min);
    }
  }
  function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean2(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  function byteSwap(word) {
    return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
  }
  function byteSwap32(arr) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = byteSwap(arr[i]);
    }
    return arr;
  }
  var swap32IfBE = isLE ? (u) => u : byteSwap32;
  function createHasher2(hashCons, info = {}) {
    const hashC = (msg2, opts2) => hashCons(opts2).update(msg2).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.create = (opts2) => hashCons(opts2);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  function randomBytes2(bytesLength = 32) {
    const cr = typeof globalThis === "object" ? globalThis.crypto : null;
    if (typeof cr?.getRandomValues !== "function")
      throw new Error("crypto.getRandomValues must be defined");
    return cr.getRandomValues(new Uint8Array(bytesLength));
  }
  var oidNist = (suffix) => ({
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@noble/post-quantum/node_modules/@noble/hashes/sha3.js
  var _0n4 = BigInt(0);
  var _1n3 = BigInt(1);
  var _2n3 = BigInt(2);
  var _7n = BigInt(7);
  var _256n = BigInt(256);
  var _0x71n = BigInt(113);
  var SHA3_PI = [];
  var SHA3_ROTL = [];
  var _SHA3_IOTA = [];
  for (let round = 0, R = _1n3, x = 1, y = 0; round < 24; round++) {
    [x, y] = [y, (2 * x + 3 * y) % 5];
    SHA3_PI.push(2 * (5 * y + x));
    SHA3_ROTL.push((round + 1) * (round + 2) / 2 % 64);
    let t = _0n4;
    for (let j = 0; j < 7; j++) {
      R = (R << _1n3 ^ (R >> _7n) * _0x71n) % _256n;
      if (R & _2n3)
        t ^= _1n3 << (_1n3 << BigInt(j)) - _1n3;
    }
    _SHA3_IOTA.push(t);
  }
  var IOTAS = split(_SHA3_IOTA, true);
  var SHA3_IOTA_H = IOTAS[0];
  var SHA3_IOTA_L = IOTAS[1];
  var rotlH = (h, l, s) => s > 32 ? rotlBH(h, l, s) : rotlSH(h, l, s);
  var rotlL = (h, l, s) => s > 32 ? rotlBL(h, l, s) : rotlSL(h, l, s);
  function keccakP(s, rounds = 24) {
    const B = new Uint32Array(5 * 2);
    for (let round = 24 - rounds; round < 24; round++) {
      for (let x = 0; x < 10; x++)
        B[x] = s[x] ^ s[x + 10] ^ s[x + 20] ^ s[x + 30] ^ s[x + 40];
      for (let x = 0; x < 10; x += 2) {
        const idx1 = (x + 8) % 10;
        const idx0 = (x + 2) % 10;
        const B0 = B[idx0];
        const B1 = B[idx0 + 1];
        const Th = rotlH(B0, B1, 1) ^ B[idx1];
        const Tl = rotlL(B0, B1, 1) ^ B[idx1 + 1];
        for (let y = 0; y < 50; y += 10) {
          s[x + y] ^= Th;
          s[x + y + 1] ^= Tl;
        }
      }
      let curH = s[2];
      let curL = s[3];
      for (let t = 0; t < 24; t++) {
        const shift = SHA3_ROTL[t];
        const Th = rotlH(curH, curL, shift);
        const Tl = rotlL(curH, curL, shift);
        const PI = SHA3_PI[t];
        curH = s[PI];
        curL = s[PI + 1];
        s[PI] = Th;
        s[PI + 1] = Tl;
      }
      for (let y = 0; y < 50; y += 10) {
        for (let x = 0; x < 10; x++)
          B[x] = s[y + x];
        for (let x = 0; x < 10; x++)
          s[y + x] ^= ~B[(x + 2) % 10] & B[(x + 4) % 10];
      }
      s[0] ^= SHA3_IOTA_H[round];
      s[1] ^= SHA3_IOTA_L[round];
    }
    clean2(B);
  }
  var Keccak = class _Keccak {
    // NOTE: we accept arguments in bytes instead of bits here.
    constructor(blockLen, suffix, outputLen, enableXOF = false, rounds = 24) {
      __publicField(this, "state");
      __publicField(this, "pos", 0);
      __publicField(this, "posOut", 0);
      __publicField(this, "finished", false);
      __publicField(this, "state32");
      __publicField(this, "destroyed", false);
      __publicField(this, "blockLen");
      __publicField(this, "suffix");
      __publicField(this, "outputLen");
      __publicField(this, "enableXOF", false);
      __publicField(this, "rounds");
      this.blockLen = blockLen;
      this.suffix = suffix;
      this.outputLen = outputLen;
      this.enableXOF = enableXOF;
      this.rounds = rounds;
      anumber3(outputLen, "outputLen");
      if (!(0 < blockLen && blockLen < 200))
        throw new Error("only keccak-f1600 function is supported");
      this.state = new Uint8Array(200);
      this.state32 = u32(this.state);
    }
    clone() {
      return this._cloneInto();
    }
    keccak() {
      swap32IfBE(this.state32);
      keccakP(this.state32, this.rounds);
      swap32IfBE(this.state32);
      this.posOut = 0;
      this.pos = 0;
    }
    update(data) {
      aexists2(this);
      abytes3(data);
      const { blockLen, state } = this;
      const len = data.length;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        for (let i = 0; i < take; i++)
          state[this.pos++] ^= data[pos++];
        if (this.pos === blockLen)
          this.keccak();
      }
      return this;
    }
    finish() {
      if (this.finished)
        return;
      this.finished = true;
      const { state, suffix, pos, blockLen } = this;
      state[pos] ^= suffix;
      if ((suffix & 128) !== 0 && pos === blockLen - 1)
        this.keccak();
      state[blockLen - 1] ^= 128;
      this.keccak();
    }
    writeInto(out) {
      aexists2(this, false);
      abytes3(out);
      this.finish();
      const bufferOut = this.state;
      const { blockLen } = this;
      for (let pos = 0, len = out.length; pos < len; ) {
        if (this.posOut >= blockLen)
          this.keccak();
        const take = Math.min(blockLen - this.posOut, len - pos);
        out.set(bufferOut.subarray(this.posOut, this.posOut + take), pos);
        this.posOut += take;
        pos += take;
      }
      return out;
    }
    xofInto(out) {
      if (!this.enableXOF)
        throw new Error("XOF is not possible for this instance");
      return this.writeInto(out);
    }
    xof(bytes2) {
      anumber3(bytes2);
      return this.xofInto(new Uint8Array(bytes2));
    }
    digestInto(out) {
      aoutput2(out, this);
      if (this.finished)
        throw new Error("digest() was already called");
      this.writeInto(out);
      this.destroy();
      return out;
    }
    digest() {
      return this.digestInto(new Uint8Array(this.outputLen));
    }
    destroy() {
      this.destroyed = true;
      clean2(this.state);
    }
    _cloneInto(to) {
      const { blockLen, suffix, outputLen, rounds, enableXOF } = this;
      to || (to = new _Keccak(blockLen, suffix, outputLen, enableXOF, rounds));
      to.state32.set(this.state32);
      to.pos = this.pos;
      to.posOut = this.posOut;
      to.finished = this.finished;
      to.rounds = rounds;
      to.suffix = suffix;
      to.outputLen = outputLen;
      to.enableXOF = enableXOF;
      to.destroyed = this.destroyed;
      return to;
    }
  };
  var genKeccak = (suffix, blockLen, outputLen, info = {}) => createHasher2(() => new Keccak(blockLen, suffix, outputLen), info);
  var sha3_256 = /* @__PURE__ */ genKeccak(
    6,
    136,
    32,
    /* @__PURE__ */ oidNist(8)
  );
  var sha3_512 = /* @__PURE__ */ genKeccak(
    6,
    72,
    64,
    /* @__PURE__ */ oidNist(10)
  );
  var genShake = (suffix, blockLen, outputLen, info = {}) => createHasher2((opts2 = {}) => new Keccak(blockLen, suffix, opts2.dkLen === void 0 ? outputLen : opts2.dkLen, true), info);
  var shake128 = /* @__PURE__ */ genShake(31, 168, 16, /* @__PURE__ */ oidNist(11));
  var shake256 = /* @__PURE__ */ genShake(31, 136, 32, /* @__PURE__ */ oidNist(12));

  // node_modules/@noble/curves/abstract/fft.js
  function checkU32(n) {
    if (!Number.isSafeInteger(n) || n < 0 || n > 4294967295)
      throw new Error("wrong u32 integer:" + n);
    return n;
  }
  function isPowerOfTwo(x) {
    checkU32(x);
    return (x & x - 1) === 0 && x !== 0;
  }
  function reverseBits(n, bits) {
    checkU32(n);
    let reversed = 0;
    for (let i = 0; i < bits; i++, n >>>= 1)
      reversed = reversed << 1 | n & 1;
    return reversed;
  }
  function log2(n) {
    checkU32(n);
    return 31 - Math.clz32(n);
  }
  function bitReversalInplace(values) {
    const n = values.length;
    if (n < 2 || !isPowerOfTwo(n))
      throw new Error("n must be a power of 2 and greater than 1. Got " + n);
    const bits = log2(n);
    for (let i = 0; i < n; i++) {
      const j = reverseBits(i, bits);
      if (i < j) {
        const tmp = values[i];
        values[i] = values[j];
        values[j] = tmp;
      }
    }
    return values;
  }
  var FFTCore = (F2, coreOpts) => {
    const { N: N2, roots, dit, invertButterflies = false, skipStages = 0, brp = true } = coreOpts;
    const bits = log2(N2);
    if (!isPowerOfTwo(N2))
      throw new Error("FFT: Polynomial size should be power of two");
    const isDit = dit !== invertButterflies;
    isDit;
    return (values) => {
      if (values.length !== N2)
        throw new Error("FFT: wrong Polynomial length");
      if (dit && brp)
        bitReversalInplace(values);
      for (let i = 0, g = 1; i < bits - skipStages; i++) {
        const s = dit ? i + 1 + skipStages : bits - i;
        const m = 1 << s;
        const m2 = m >> 1;
        const stride = N2 >> s;
        for (let k = 0; k < N2; k += m) {
          for (let j = 0, grp = g++; j < m2; j++) {
            const rootPos = invertButterflies ? dit ? N2 - grp : grp : j * stride;
            const i0 = k + j;
            const i1 = k + j + m2;
            const omega = roots[rootPos];
            const b = values[i1];
            const a = values[i0];
            if (isDit) {
              const t = F2.mul(b, omega);
              values[i0] = F2.add(a, t);
              values[i1] = F2.sub(a, t);
            } else if (invertButterflies) {
              values[i0] = F2.add(b, a);
              values[i1] = F2.mul(F2.sub(b, a), omega);
            } else {
              values[i0] = F2.add(a, b);
              values[i1] = F2.mul(F2.sub(a, b), omega);
            }
          }
        }
      }
      if (!dit && brp)
        bitReversalInplace(values);
      return values;
    };
  };

  // node_modules/@noble/post-quantum/utils.js
  var randomBytes3 = randomBytes2;
  function equalBytes(a, b) {
    if (a.length !== b.length)
      return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
      diff |= a[i] ^ b[i];
    return diff === 0;
  }
  function copyBytes2(bytes2) {
    return Uint8Array.from(bytes2);
  }
  function splitCoder(label, ...lengths) {
    const getLength = (c) => typeof c === "number" ? c : c.bytesLen;
    const bytesLen = lengths.reduce((sum, a) => sum + getLength(a), 0);
    return {
      bytesLen,
      encode: (bufs) => {
        const res = new Uint8Array(bytesLen);
        for (let i = 0, pos = 0; i < lengths.length; i++) {
          const c = lengths[i];
          const l = getLength(c);
          const b = typeof c === "number" ? bufs[i] : c.encode(bufs[i]);
          abytes3(b, l, label);
          res.set(b, pos);
          if (typeof c !== "number")
            b.fill(0);
          pos += l;
        }
        return res;
      },
      decode: (buf) => {
        abytes3(buf, bytesLen, label);
        const res = [];
        for (const c of lengths) {
          const l = getLength(c);
          const b = buf.subarray(0, l);
          res.push(typeof c === "number" ? b : c.decode(b));
          buf = buf.subarray(l);
        }
        return res;
      }
    };
  }
  function vecCoder(c, vecLen) {
    const bytesLen = vecLen * c.bytesLen;
    return {
      bytesLen,
      encode: (u) => {
        if (u.length !== vecLen)
          throw new Error(`vecCoder.encode: wrong length=${u.length}. Expected: ${vecLen}`);
        const res = new Uint8Array(bytesLen);
        for (let i = 0, pos = 0; i < u.length; i++) {
          const b = c.encode(u[i]);
          res.set(b, pos);
          b.fill(0);
          pos += b.length;
        }
        return res;
      },
      decode: (a) => {
        abytes3(a, bytesLen);
        const r = [];
        for (let i = 0; i < a.length; i += c.bytesLen)
          r.push(c.decode(a.subarray(i, i + c.bytesLen)));
        return r;
      }
    };
  }
  function cleanBytes(...list) {
    for (const t of list) {
      if (Array.isArray(t))
        for (const b of t)
          b.fill(0);
      else
        t.fill(0);
    }
  }
  function getMask(bits) {
    return (1 << bits) - 1;
  }
  var EMPTY = Uint8Array.of();

  // node_modules/@noble/post-quantum/_crystals.js
  var genCrystals = (opts2) => {
    const { newPoly, N: N2, Q: Q2, F: F2, ROOT_OF_UNITY: ROOT_OF_UNITY2, brvBits, isKyber } = opts2;
    const mod3 = (a, modulo = Q2) => {
      const result = a % modulo | 0;
      return (result >= 0 ? result | 0 : modulo + result | 0) | 0;
    };
    const smod = (a, modulo = Q2) => {
      const r = mod3(a, modulo) | 0;
      return (r > modulo >> 1 ? r - modulo | 0 : r) | 0;
    };
    function getZettas() {
      const out = newPoly(N2);
      for (let i = 0; i < N2; i++) {
        const b = reverseBits(i, brvBits);
        const p = BigInt(ROOT_OF_UNITY2) ** BigInt(b) % BigInt(Q2);
        out[i] = Number(p) | 0;
      }
      return out;
    }
    const nttZetas2 = getZettas();
    const field = {
      add: (a, b) => mod3((a | 0) + (b | 0)) | 0,
      sub: (a, b) => mod3((a | 0) - (b | 0)) | 0,
      mul: (a, b) => mod3((a | 0) * (b | 0)) | 0,
      inv: (_a) => {
        throw new Error("not implemented");
      }
    };
    const nttOpts = {
      N: N2,
      roots: nttZetas2,
      invertButterflies: true,
      skipStages: isKyber ? 1 : 0,
      brp: false
    };
    const dif = FFTCore(field, { dit: false, ...nttOpts });
    const dit = FFTCore(field, { dit: true, ...nttOpts });
    const NTT2 = {
      encode: (r) => {
        return dif(r);
      },
      decode: (r) => {
        dit(r);
        for (let i = 0; i < r.length; i++)
          r[i] = mod3(F2 * r[i]);
        return r;
      }
    };
    const bitsCoder2 = (d, c) => {
      const mask = getMask(d);
      const bytesLen = d * (N2 / 8);
      return {
        bytesLen,
        encode: (poly) => {
          const r = new Uint8Array(bytesLen);
          for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < poly.length; i++) {
            buf |= (c.encode(poly[i]) & mask) << bufLen;
            bufLen += d;
            for (; bufLen >= 8; bufLen -= 8, buf >>= 8)
              r[pos++] = buf & getMask(bufLen);
          }
          return r;
        },
        decode: (bytes2) => {
          const r = newPoly(N2);
          for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < bytes2.length; i++) {
            buf |= bytes2[i] << bufLen;
            bufLen += 8;
            for (; bufLen >= d; bufLen -= d, buf >>= d)
              r[pos++] = c.decode(buf & mask);
          }
          return r;
        }
      };
    };
    return { mod: mod3, smod, nttZetas: nttZetas2, NTT: NTT2, bitsCoder: bitsCoder2 };
  };
  var createXofShake = (shake) => (seed, blockLen) => {
    if (!blockLen)
      blockLen = shake.blockLen;
    const _seed = new Uint8Array(seed.length + 2);
    _seed.set(seed);
    const seedLen = seed.length;
    const buf = new Uint8Array(blockLen);
    let h = shake.create({});
    let calls = 0;
    let xofs = 0;
    return {
      stats: () => ({ calls, xofs }),
      get: (x, y) => {
        _seed[seedLen + 0] = x;
        _seed[seedLen + 1] = y;
        h.destroy();
        h = shake.create({}).update(_seed);
        calls++;
        return () => {
          xofs++;
          return h.xofInto(buf);
        };
      },
      clean: () => {
        h.destroy();
        cleanBytes(buf, _seed);
      }
    };
  };
  var XOF128 = /* @__PURE__ */ createXofShake(shake128);

  // node_modules/@noble/post-quantum/ml-kem.js
  var N = 256;
  var Q = 3329;
  var F = 3303;
  var ROOT_OF_UNITY = 17;
  var { mod: mod2, nttZetas, NTT, bitsCoder } = genCrystals({
    N,
    Q,
    F,
    ROOT_OF_UNITY,
    newPoly: (n) => new Uint16Array(n),
    brvBits: 7,
    isKyber: true
  });
  var PARAMS = {
    512: { N, Q, K: 2, ETA1: 3, ETA2: 2, du: 10, dv: 4, RBGstrength: 128 },
    768: { N, Q, K: 3, ETA1: 2, ETA2: 2, du: 10, dv: 4, RBGstrength: 192 },
    1024: { N, Q, K: 4, ETA1: 2, ETA2: 2, du: 11, dv: 5, RBGstrength: 256 }
  };
  var compress = (d) => {
    if (d >= 12)
      return { encode: (i) => i, decode: (i) => i };
    const a = 2 ** (d - 1);
    return {
      // const compress = (i: number) => round((2 ** d / Q) * i) % 2 ** d;
      encode: (i) => ((i << d) + Q / 2) / Q,
      // const decompress = (i: number) => round((Q / 2 ** d) * i);
      decode: (i) => i * Q + a >>> d
    };
  };
  var polyCoder = (d) => bitsCoder(d, compress(d));
  function polyAdd(a, b) {
    for (let i = 0; i < N; i++)
      a[i] = mod2(a[i] + b[i]);
  }
  function polySub(a, b) {
    for (let i = 0; i < N; i++)
      a[i] = mod2(a[i] - b[i]);
  }
  function BaseCaseMultiply(a0, a1, b0, b1, zeta) {
    const c0 = mod2(a1 * b1 * zeta + a0 * b0);
    const c1 = mod2(a0 * b1 + a1 * b0);
    return { c0, c1 };
  }
  function MultiplyNTTs(f, g) {
    for (let i = 0; i < N / 2; i++) {
      let z = nttZetas[64 + (i >> 1)];
      if (i & 1)
        z = -z;
      const { c0, c1 } = BaseCaseMultiply(f[2 * i + 0], f[2 * i + 1], g[2 * i + 0], g[2 * i + 1], z);
      f[2 * i + 0] = c0;
      f[2 * i + 1] = c1;
    }
    return f;
  }
  function SampleNTT(xof) {
    const r = new Uint16Array(N);
    for (let j = 0; j < N; ) {
      const b = xof();
      if (b.length % 3)
        throw new Error("SampleNTT: unaligned block");
      for (let i = 0; j < N && i + 3 <= b.length; i += 3) {
        const d1 = (b[i + 0] >> 0 | b[i + 1] << 8) & 4095;
        const d2 = (b[i + 1] >> 4 | b[i + 2] << 4) & 4095;
        if (d1 < Q)
          r[j++] = d1;
        if (j < N && d2 < Q)
          r[j++] = d2;
      }
    }
    return r;
  }
  function sampleCBD(PRF, seed, nonce, eta) {
    const buf = PRF(eta * N / 4, seed, nonce);
    const r = new Uint16Array(N);
    const b32 = u32(buf);
    let len = 0;
    for (let i = 0, p = 0, bb = 0, t0 = 0; i < b32.length; i++) {
      let b = b32[i];
      for (let j = 0; j < 32; j++) {
        bb += b & 1;
        b >>= 1;
        len += 1;
        if (len === eta) {
          t0 = bb;
          bb = 0;
        } else if (len === 2 * eta) {
          r[p++] = mod2(t0 - bb);
          bb = 0;
          len = 0;
        }
      }
    }
    if (len)
      throw new Error(`sampleCBD: leftover bits: ${len}`);
    return r;
  }
  var genKPKE = (opts2) => {
    const { K, PRF, XOF, HASH512, ETA1, ETA2, du, dv } = opts2;
    const poly1 = polyCoder(1);
    const polyV = polyCoder(dv);
    const polyU = polyCoder(du);
    const publicCoder = splitCoder("publicKey", vecCoder(polyCoder(12), K), 32);
    const secretCoder = vecCoder(polyCoder(12), K);
    const cipherCoder = splitCoder("ciphertext", vecCoder(polyU, K), polyV);
    const seedCoder = splitCoder("seed", 32, 32);
    return {
      secretCoder,
      lengths: {
        secretKey: secretCoder.bytesLen,
        publicKey: publicCoder.bytesLen,
        cipherText: cipherCoder.bytesLen
      },
      keygen: (seed) => {
        abytes3(seed, 32, "seed");
        const seedDst = new Uint8Array(33);
        seedDst.set(seed);
        seedDst[32] = K;
        const seedHash = HASH512(seedDst);
        const [rho, sigma] = seedCoder.decode(seedHash);
        const sHat = [];
        const tHat = [];
        for (let i = 0; i < K; i++)
          sHat.push(NTT.encode(sampleCBD(PRF, sigma, i, ETA1)));
        const x = XOF(rho);
        for (let i = 0; i < K; i++) {
          const e = NTT.encode(sampleCBD(PRF, sigma, K + i, ETA1));
          for (let j = 0; j < K; j++) {
            const aji = SampleNTT(x.get(j, i));
            polyAdd(e, MultiplyNTTs(aji, sHat[j]));
          }
          tHat.push(e);
        }
        x.clean();
        const res = {
          publicKey: publicCoder.encode([tHat, rho]),
          secretKey: secretCoder.encode(sHat)
        };
        cleanBytes(rho, sigma, sHat, tHat, seedDst, seedHash);
        return res;
      },
      encrypt: (publicKey, msg2, seed) => {
        const [tHat, rho] = publicCoder.decode(publicKey);
        const rHat = [];
        for (let i = 0; i < K; i++)
          rHat.push(NTT.encode(sampleCBD(PRF, seed, i, ETA1)));
        const x = XOF(rho);
        const tmp2 = new Uint16Array(N);
        const u = [];
        for (let i = 0; i < K; i++) {
          const e1 = sampleCBD(PRF, seed, K + i, ETA2);
          const tmp = new Uint16Array(N);
          for (let j = 0; j < K; j++) {
            const aij = SampleNTT(x.get(i, j));
            polyAdd(tmp, MultiplyNTTs(aij, rHat[j]));
          }
          polyAdd(e1, NTT.decode(tmp));
          u.push(e1);
          polyAdd(tmp2, MultiplyNTTs(tHat[i], rHat[i]));
          cleanBytes(tmp);
        }
        x.clean();
        const e2 = sampleCBD(PRF, seed, 2 * K, ETA2);
        polyAdd(e2, NTT.decode(tmp2));
        const v = poly1.decode(msg2);
        polyAdd(v, e2);
        cleanBytes(tHat, rHat, tmp2, e2);
        return cipherCoder.encode([u, v]);
      },
      decrypt: (cipherText, privateKey) => {
        const [u, v] = cipherCoder.decode(cipherText);
        const sk = secretCoder.decode(privateKey);
        const tmp = new Uint16Array(N);
        for (let i = 0; i < K; i++)
          polyAdd(tmp, MultiplyNTTs(sk[i], NTT.encode(u[i])));
        polySub(v, NTT.decode(tmp));
        cleanBytes(tmp, sk, u);
        return poly1.encode(v);
      }
    };
  };
  function createKyber(opts2) {
    const KPKE = genKPKE(opts2);
    const { HASH256, HASH512, KDF } = opts2;
    const { secretCoder: KPKESecretCoder, lengths } = KPKE;
    const secretCoder = splitCoder("secretKey", lengths.secretKey, lengths.publicKey, 32, 32);
    const msgLen = 32;
    const seedLen = 64;
    return {
      info: { type: "ml-kem" },
      lengths: {
        ...lengths,
        seed: 64,
        msg: msgLen,
        msgRand: msgLen,
        secretKey: secretCoder.bytesLen
      },
      keygen: (seed = randomBytes3(seedLen)) => {
        abytes3(seed, seedLen, "seed");
        const { publicKey, secretKey: sk } = KPKE.keygen(seed.subarray(0, 32));
        const publicKeyHash = HASH256(publicKey);
        const secretKey = secretCoder.encode([sk, publicKey, publicKeyHash, seed.subarray(32)]);
        cleanBytes(sk, publicKeyHash);
        return { publicKey, secretKey };
      },
      getPublicKey: (secretKey) => {
        const [_sk, publicKey, _publicKeyHash, _z] = secretCoder.decode(secretKey);
        return Uint8Array.from(publicKey);
      },
      encapsulate: (publicKey, msg2 = randomBytes3(msgLen)) => {
        abytes3(publicKey, lengths.publicKey, "publicKey");
        abytes3(msg2, msgLen, "message");
        const eke = publicKey.subarray(0, 384 * opts2.K);
        const ek = KPKESecretCoder.encode(KPKESecretCoder.decode(copyBytes2(eke)));
        if (!equalBytes(ek, eke)) {
          cleanBytes(ek);
          throw new Error("ML-KEM.encapsulate: wrong publicKey modulus");
        }
        cleanBytes(ek);
        const kr = HASH512.create().update(msg2).update(HASH256(publicKey)).digest();
        const cipherText = KPKE.encrypt(publicKey, msg2, kr.subarray(32, 64));
        cleanBytes(kr.subarray(32));
        return { cipherText, sharedSecret: kr.subarray(0, 32) };
      },
      decapsulate: (cipherText, secretKey) => {
        abytes3(secretKey, secretCoder.bytesLen, "secretKey");
        abytes3(cipherText, lengths.cipherText, "cipherText");
        const k768 = secretCoder.bytesLen - 96;
        const start = k768 + 32;
        const test = HASH256(secretKey.subarray(k768 / 2, start));
        if (!equalBytes(test, secretKey.subarray(start, start + 32)))
          throw new Error("invalid secretKey: hash check failed");
        const [sk, publicKey, publicKeyHash, z] = secretCoder.decode(secretKey);
        const msg2 = KPKE.decrypt(cipherText, sk);
        const kr = HASH512.create().update(msg2).update(publicKeyHash).digest();
        const Khat = kr.subarray(0, 32);
        const cipherText2 = KPKE.encrypt(publicKey, msg2, kr.subarray(32, 64));
        const isValid = equalBytes(cipherText, cipherText2);
        const Kbar = KDF.create({ dkLen: 32 }).update(z).update(cipherText).digest();
        cleanBytes(msg2, cipherText2, !isValid ? Khat : Kbar);
        return isValid ? Khat : Kbar;
      }
    };
  }
  function shakePRF(dkLen, key, nonce) {
    return shake256.create({ dkLen }).update(key).update(new Uint8Array([nonce])).digest();
  }
  var opts = {
    HASH256: sha3_256,
    HASH512: sha3_512,
    KDF: shake256,
    XOF: XOF128,
    PRF: shakePRF
  };
  var ml_kem512 = /* @__PURE__ */ createKyber({
    ...opts,
    ...PARAMS[512]
  });
  var ml_kem768 = /* @__PURE__ */ createKyber({
    ...opts,
    ...PARAMS[768]
  });
  var ml_kem1024 = /* @__PURE__ */ createKyber({
    ...opts,
    ...PARAMS[1024]
  });

  // trashmail-addon/ts/e-client.ts
  var HKDF_INFO = new TextEncoder().encode("trashmail-hybrid-kem-v1");
  var PADDING_BUCKETS = [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216];
  var TransportFehler = class extends Error {
    constructor(meldung, ursache) {
      super(meldung);
      this.ursache = ursache;
      this.name = "TransportFehler";
    }
  };
  function zuBase64(bytes2) {
    let s = "";
    for (const b of bytes2) {
      s += String.fromCharCode(b);
    }
    return btoa(s);
  }
  function ausBase64(text) {
    let t = text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4 !== 0) {
      t += "=";
    }
    const bin = atob(t);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  function kopie(bytes2) {
    const neu = new Uint8Array(new ArrayBuffer(bytes2.length));
    neu.set(bytes2);
    return neu;
  }
  function gemeinsam(x25519Geteilt, mlKemGeteilt) {
    const zusammen = new Uint8Array(x25519Geteilt.length + mlKemGeteilt.length);
    zusammen.set(x25519Geteilt, 0);
    zusammen.set(mlKemGeteilt, x25519Geteilt.length);
    return hkdf(sha2562, zusammen, void 0, HKDF_INFO, 32);
  }
  function kapseln(x25519Pub, mlKemPub) {
    const ephemer = x25519.utils.randomSecretKey();
    const x25519Geteilt = x25519.getSharedSecret(ephemer, x25519Pub);
    const { cipherText, sharedSecret } = ml_kem1024.encapsulate(mlKemPub);
    return { x25519Ct: x25519.getPublicKey(ephemer), mlKemCt: cipherText, geheim: gemeinsam(x25519Geteilt, sharedSecret) };
  }
  function entkapseln(x25519Ct, mlKemCt, x25519Priv, mlKemPriv) {
    return gemeinsam(x25519.getSharedSecret(x25519Priv, x25519Ct), ml_kem1024.decapsulate(mlKemCt, mlKemPriv));
  }
  function hybridSchluesselpaar() {
    const x25519Priv = x25519.utils.randomSecretKey();
    const saat = crypto.getRandomValues(new Uint8Array(64));
    const ml = ml_kem1024.keygen(saat);
    return { x25519Priv, x25519Pub: x25519.getPublicKey(x25519Priv), mlKemPriv: ml.secretKey, mlKemPub: ml.publicKey };
  }
  async function aesVerschluesseln(geheim, klartext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const schluessel = await crypto.subtle.importKey("raw", kopie(geheim), "AES-GCM", false, ["encrypt"]);
    const roh = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, schluessel, kopie(klartext)));
    const tag = roh.slice(roh.length - 16);
    const daten = roh.slice(0, roh.length - 16);
    const out = new Uint8Array(28 + daten.length);
    out.set(iv, 0);
    out.set(tag, 12);
    out.set(daten, 28);
    return out;
  }
  async function aesEntschluesseln(geheim, paket) {
    if (paket.length < 28) {
      throw new TransportFehler("Antwort zu kurz");
    }
    const iv = paket.slice(0, 12);
    const tag = paket.slice(12, 28);
    const daten = paket.slice(28);
    const zusammen = new Uint8Array(daten.length + 16);
    zusammen.set(daten, 0);
    zusammen.set(tag, daten.length);
    const schluessel = await crypto.subtle.importKey("raw", kopie(geheim), "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, schluessel, zusammen));
  }
  async function strom(daten, art) {
    const s = art === "gzip-ein" ? new CompressionStream("gzip") : new DecompressionStream("gzip");
    const schreiber = s.writable.getWriter();
    void schreiber.write(kopie(daten));
    void schreiber.close();
    return new Uint8Array(await new Response(s.readable).arrayBuffer());
  }
  async function auspacken(daten) {
    let d = daten;
    if (d.length >= 6 && d[0] === 222 && d[1] === 173 && PADDING_BUCKETS.includes(d.length)) {
      const laenge = ((d[2] ?? 0) << 24 | (d[3] ?? 0) << 16 | (d[4] ?? 0) << 8 | (d[5] ?? 0)) >>> 0;
      if (laenge <= d.length - 6) {
        d = d.slice(6, 6 + laenge);
      }
    }
    if (d.length >= 2 && d[0] === 31 && d[1] === 139) {
      d = await strom(d, "gzip-aus");
    }
    return d;
  }
  var EClient = class {
    constructor(basis, sprache, holen = fetch.bind(globalThis)) {
      this.basis = basis;
      this.sprache = sprache;
      this.holen = holen;
      this.schluessel = [];
      /**
       * Die Server-Schlüssel sind an die PHP-Sitzung gebunden, die sie ausgegeben
       * hat ("Key belongs to different session"). Ohne Cookie erfahren wir die
       * Kennung aus der Antwort von get_encryption_keys und schicken sie danach
       * als X-TrashMail-Session mit (gemessen gegen Dev am 05.11.2026).
       */
      this.sitzung = "";
    }
    async initialisieren(anzahl = 5) {
      let antwort;
      try {
        antwort = await this.holen(`${this.basis}/?api=1&cmd=get_encryption_keys&lang=${encodeURIComponent(this.sprache)}`, {
          method: "POST",
          credentials: "omit",
          headers: this.kopfzeilen(),
          body: JSON.stringify({ count: anzahl })
        });
      } catch (fehler) {
        throw new TransportFehler("Server nicht erreichbar", fehler);
      }
      const json = await antwort.json();
      if (typeof json.session_id === "string" && json.session_id !== "") {
        this.sitzung = json.session_id;
      }
      if (!json.success || !Array.isArray(json.keys) || json.keys.length === 0) {
        throw new TransportFehler("Keine Schl\xFCssel f\xFCr den verschl\xFCsselten Weg");
      }
      this.schluessel.push(...json.keys);
    }
    kopfzeilen() {
      const k = { "Content-Type": "application/json" };
      if (this.sitzung) {
        k["X-TrashMail-Session"] = this.sitzung;
      }
      return k;
    }
    /** Schickt ein Kommando über /e und liefert die entschlüsselte Antwort. */
    async senden(cmd, parameter) {
      if (this.schluessel.length === 0) {
        await this.initialisieren();
      }
      const schluessel = this.schluessel.shift();
      const eigen = hybridSchluesselpaar();
      const klartext = await strom(new TextEncoder().encode(JSON.stringify({ cmd, lang: this.sprache, ...parameter })), "gzip-ein");
      const kapsel = kapseln(ausBase64(schluessel.x25519_pub), ausBase64(schluessel.mlkem_pub));
      const nutzlast = {
        encrypted_payload: zuBase64(await aesVerschluesseln(kapsel.geheim, klartext)),
        key_uuid: schluessel.uuid,
        x25519_ciphertext: zuBase64(kapsel.x25519Ct),
        mlkem_ciphertext: zuBase64(kapsel.mlKemCt),
        response_x25519_pub: zuBase64(eigen.x25519Pub),
        response_mlkem_pub: zuBase64(eigen.mlKemPub)
      };
      let antwort;
      try {
        antwort = await this.holen(`${this.basis}/e`, { method: "POST", credentials: "omit", headers: this.kopfzeilen(), body: JSON.stringify(nutzlast) });
      } catch (fehler) {
        throw new TransportFehler("Server nicht erreichbar", fehler);
      }
      const json = await antwort.json();
      if (typeof json.encrypted_response !== "string" || typeof json.response_x25519_ciphertext !== "string" || typeof json.response_mlkem_ciphertext !== "string") {
        throw new TransportFehler("Antwort war nicht verschl\xFCsselt");
      }
      const geheim = entkapseln(ausBase64(json.response_x25519_ciphertext), ausBase64(json.response_mlkem_ciphertext), eigen.x25519Priv, eigen.mlKemPriv);
      const klar = await auspacken(await aesEntschluesseln(geheim, ausBase64(json.encrypted_response)));
      return JSON.parse(new TextDecoder().decode(klar));
    }
  };

  // trashmail-addon/ts/help/ki-hilfe-konstanten.ts
  var SPEICHER_INSTALLATION = "ki_installation_id";
  var SPEICHER_LETZTE_MELDUNG = "ki_letzte_meldung";
  var SPEICHER_VORGABE_FRAGE = "ki_vorgabe_frage";

  // trashmail-addon/ts/help/ki-hilfe.ts
  var browser = globalThis.browser ?? chrome;
  var STANDARD_BASIS = "https://mail.aionda.com";
  var HILFE_SPRACHEN = ["de", "en", "es", "fr"];
  var MAX_RUNDEN = 3;
  var HILFE_ZEICHEN = 8e3;
  var GRENZEN = { nachrichten: 16, frageBytes: 1900, werkzeugBytes: 8800, gesamtBytes: 38e3 };
  var MAX_VERLAUF_NACHRICHTEN = 6;
  var kodierer = new TextEncoder();
  var bytes = (s) => kodierer.encode(s).length;
  function utf8Kuerzen(text, maxBytes) {
    if (bytes(text) <= maxBytes) {
      return text;
    }
    let aus = "";
    let n = 0;
    for (const zeichen of text) {
      const b = bytes(zeichen);
      if (n + b > maxBytes) {
        break;
      }
      aus += zeichen;
      n += b;
    }
    return aus;
  }
  function werkzeugNachricht(id, thema, text, maxBytes = GRENZEN.werkzeugBytes) {
    const leer = bytes(JSON.stringify({ topic: thema, content: "" }));
    let inhalt = utf8Kuerzen(text, Math.max(0, maxBytes - leer));
    while (bytes(JSON.stringify({ topic: thema, content: inhalt })) > maxBytes && inhalt.length > 0) {
      inhalt = utf8Kuerzen(inhalt, bytes(inhalt) - 64);
    }
    return { role: "tool", tool_call_id: id, content: JSON.stringify({ topic: thema, content: inhalt }) };
  }
  function serverBytes(nachrichten) {
    let summe = 0;
    for (const m of nachrichten) {
      summe += bytes(m.content);
      if (m.tool_call_id) {
        summe += bytes(m.tool_call_id);
      }
      for (const c of m.tool_calls ?? []) {
        summe += bytes(c.id) + bytes(c.function.arguments);
      }
    }
    return summe;
  }
  function gespraechFuerServer(verlauf, runde) {
    let alt = verlauf.filter((m) => m.role !== "tool" && !m.tool_calls).slice(-MAX_VERLAUF_NACHRICHTEN);
    const passt = (v) => v.length + runde.length <= GRENZEN.nachrichten && serverBytes([...v, ...runde]) <= GRENZEN.gesamtBytes;
    while (alt.length > 0 && !passt(alt)) {
      alt = alt.slice(2);
    }
    if (passt(alt)) {
      return [...alt, ...runde];
    }
    const werkzeuge = runde.filter((m) => m.role === "tool");
    const rest = serverBytes(runde.filter((m) => m.role !== "tool")) + werkzeuge.reduce((s, m) => s + bytes(m.tool_call_id ?? ""), 0);
    const jeWerkzeug = Math.floor((GRENZEN.gesamtBytes - rest) / Math.max(1, werkzeuge.length));
    return runde.map((m) => {
      if (m.role !== "tool") {
        return m;
      }
      const { topic, content } = JSON.parse(m.content);
      return werkzeugNachricht(m.tool_call_id ?? "", topic, content, jeWerkzeug);
    });
  }
  function kanalFuer(ua) {
    if (ua.includes("Firefox")) {
      return "addon-firefox";
    }
    if (ua.includes("Edg/")) {
      return "addon-edge";
    }
    if (ua.includes("OPR/")) {
      return "addon-opera";
    }
    if (ua.includes("Chrome")) {
      return "addon-chrome";
    }
    if (ua.includes("Safari")) {
      return "addon-safari";
    }
    return "addon-chrome";
  }
  function serverSprache(ui) {
    const l = ui.toLowerCase();
    if (l.startsWith("pt-br") || l === "pt_br") {
      return "br";
    }
    if (l.startsWith("pt")) {
      return "pt";
    }
    const kurz = l.slice(0, 2);
    return ["de", "en", "es", "fr"].includes(kurz) ? kurz : "en";
  }
  function hilfeSprache(serverSpr) {
    return HILFE_SPRACHEN.includes(serverSpr) ? serverSpr : "en";
  }
  function kontextFuerKi(version, kanal, zugriff, letzteMeldung) {
    const k = { erweiterung_version: version, browser: kanal, berechtigung_websites: zugriff, seite: "erweiterung" };
    if (letzteMeldung && letzteMeldung.trim() !== "") {
      k.fehlermeldungen = [letzteMeldung.trim().slice(0, 300)];
    }
    return k;
  }
  function hilfeText(html) {
    const titel = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const text = html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, HILFE_ZEICHEN);
    return { titel, text };
  }
  function antwortHtml(text) {
    const sicher = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return sicher.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
  }
  function msg(schluessel, ...ersatz) {
    return browser.i18n.getMessage(schluessel, ersatz) || schluessel;
  }
  async function basisAdresse() {
    try {
      const r = await browser.storage.local.get("debugApiUrl");
      return typeof r.debugApiUrl === "string" && r.debugApiUrl !== "" ? r.debugApiUrl : STANDARD_BASIS;
    } catch {
      return STANDARD_BASIS;
    }
  }
  async function installationsKennung() {
    const r = await browser.storage.local.get(SPEICHER_INSTALLATION);
    const vorhanden = r[SPEICHER_INSTALLATION];
    if (typeof vorhanden === "string" && /^[0-9a-f-]{36}$/.test(vorhanden)) {
      return vorhanden;
    }
    const neu = crypto.randomUUID();
    await browser.storage.local.set({ [SPEICHER_INSTALLATION]: neu });
    return neu;
  }
  async function main() {
    const verlaufEl = document.getElementById("verlauf");
    const eingabe = document.getElementById("eingabe");
    const senden = document.getElementById("senden");
    const kontextEl = document.getElementById("kontext");
    const basis = await basisAdresse();
    const sprache = serverSprache(browser.i18n.getUILanguage());
    const kanal = kanalFuer(navigator.userAgent);
    const version = browser.runtime.getManifest().version;
    let zugriff = false;
    try {
      zugriff = await browser.permissions.contains({ origins: [`${basis}/*`] });
    } catch {
      zugriff = false;
    }
    const gespeichert = await browser.storage.local.get(SPEICHER_LETZTE_MELDUNG);
    const kontext = kontextFuerKi(version, kanal, zugriff, gespeichert[SPEICHER_LETZTE_MELDUNG]);
    const installation = await installationsKennung();
    const client = new EClient(basis, sprache);
    const verlauf = [];
    const teile = [`Aionda Mail ${version}`, kanal.replace("addon-", ""), msg(zugriff ? "kiKontextZugriffAn" : "kiKontextZugriffAus")];
    if (kontext.fehlermeldungen) {
      teile.push(msg("kiKontextFehler", kontext.fehlermeldungen[0]));
    }
    kontextEl.textContent = `${msg("kiKontextTitel")} ${teile.join(" \xB7 ")}`;
    const zeige = (klasse, inhalt, alsHtml = false) => {
      const el = document.createElement("div");
      el.className = klasse;
      if (alsHtml) {
        el.innerHTML = inhalt;
      } else {
        el.textContent = inhalt;
      }
      verlaufEl.appendChild(el);
      verlaufEl.scrollTop = verlaufEl.scrollHeight;
      return el;
    };
    zeige("blase ki", msg("kiBegruessung"));
    const frage = async (text) => {
      const t = text.trim();
      if (t === "" || senden.disabled) {
        return;
      }
      document.getElementById("vorschlaege")?.remove();
      zeige("blase du", t);
      const runde = [{ role: "user", content: utf8Kuerzen(t, GRENZEN.frageBytes) }];
      eingabe.value = "";
      senden.disabled = true;
      const denkt = zeige("denkt", msg("kiDenkt"));
      try {
        for (let zug = 0; zug < MAX_RUNDEN; zug++) {
          const antwort = await client.senden("ai_assistant_public", {
            messages: gespraechFuerServer(verlauf, runde),
            installation_id: installation,
            kanal,
            persona: "nova",
            sprache,
            kontext
          });
          if (antwort.success !== true) {
            const code = Number(antwort.error_code);
            zeige("fehler", msg(code === 145 ? "kiFehlerLimit" : code === 171 ? "kiFehlerBesetzt" : "kiFehlerAllgemein"));
            return;
          }
          const daten = antwort.data ?? antwort;
          if (!daten.tool_calls || daten.tool_calls.length === 0) {
            zeige("blase ki", antwortHtml(daten.content ?? ""), true);
            verlauf.push(runde[0], { role: "assistant", content: daten.content ?? "" });
            return;
          }
          runde.push({ role: "assistant", content: daten.content ?? "", tool_calls: daten.tool_calls });
          for (const aufruf of daten.tool_calls) {
            const thema = String(JSON.parse(aufruf.function.arguments).topic ?? "");
            let inhalt = { titel: thema, text: "" };
            if (/^[a-z-]+$/.test(thema)) {
              const r = await fetch(`${basis}/help/${hilfeSprache(sprache)}/${thema}.html`, { credentials: "omit" });
              if (r.ok) {
                inhalt = hilfeText(await r.text());
              }
            }
            zeige("quelle", msg("kiLiestHilfe", inhalt.titel || thema));
            runde.push(werkzeugNachricht(aufruf.id, thema, inhalt.text || "Help topic not found."));
          }
        }
        zeige("fehler", msg("kiFehlerAllgemein"));
      } catch (fehler) {
        console.warn("[KI-Hilfe]", fehler instanceof TransportFehler ? fehler.message : fehler);
        zeige("fehler", msg("kiFehlerAllgemein"));
      } finally {
        denkt.remove();
        senden.disabled = false;
        eingabe.focus();
      }
    };
    document.getElementById("formular").addEventListener("submit", (e) => {
      e.preventDefault();
      void frage(eingabe.value);
    });
    eingabe.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void frage(eingabe.value);
      }
    });
    for (const knopf of document.querySelectorAll("#vorschlaege button")) {
      knopf.addEventListener("click", () => {
        void frage(msg(knopf.dataset.frageI18n));
      });
    }
    document.getElementById("support").addEventListener("click", () => {
      void browser.tabs.create({ url: "https://aionda.com/kontakt/" });
    });
    const vorgabe = await browser.storage.local.get(SPEICHER_VORGABE_FRAGE);
    await browser.storage.local.remove(SPEICHER_VORGABE_FRAGE);
    const vorgegeben = vorgabe[SPEICHER_VORGABE_FRAGE];
    if (vorgegeben) {
      void frage(vorgegeben);
    } else {
      eingabe.focus();
    }
  }
  if (typeof document !== "undefined" && document.getElementById("verlauf")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        void main();
      });
    } else {
      void main();
    }
  }
})();
/*! Bundled license information:

@noble/hashes/utils.js:
@noble/hashes/esm/utils.js:
@noble/hashes/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/curves/utils.js:
@noble/curves/abstract/modular.js:
@noble/curves/abstract/curve.js:
@noble/curves/abstract/montgomery.js:
@noble/curves/ed25519.js:
  (*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/post-quantum/utils.js:
@noble/post-quantum/_crystals.js:
@noble/post-quantum/ml-kem.js:
  (*! noble-post-quantum - MIT License (c) 2024 Paul Miller (paulmillr.com) *)
*/
