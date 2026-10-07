// Minimal Node Buffer operations used by frontend-analysis and abaplint.
// Decode with the browser UTF-8 decoder, including replacement of invalid bytes.
const Buffer = {
  byteLength(value) { return new TextEncoder().encode(String(value)).length; },
  from(value, encoding = 'utf8') {
    let bytes;
    if (encoding === 'hex') {
      const text = String(value), values = [];
      for (let i = 0; i + 1 < text.length; i += 2) {
        const pair = text.slice(i, i + 2);
        if (!/^[0-9a-f]{2}$/i.test(pair)) break;
        values.push(parseInt(pair, 16));
      }
      bytes = new Uint8Array(values);
    } else if (encoding === 'utf8' || encoding === 'utf-8') {
      bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    } else { throw new Error('Unsupported browser Buffer encoding: ' + encoding); }
    bytes.toString = function (format = 'utf8') {
      if (format === 'hex') return Array.from(this, byte => byte.toString(16).padStart(2, '0')).join('');
      if (format !== 'utf8' && format !== 'utf-8') throw new Error('Unsupported browser Buffer encoding: ' + format);
      return new TextDecoder('utf-8').decode(this);
    };
    return bytes;
  }
};
