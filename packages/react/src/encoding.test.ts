import { describe, expect, it } from 'vitest';
import {
  base58ToBytes,
  base64ToBytes,
  bytesToBase64,
  hexToDecimalString,
  isHex,
  toHexQuantity,
  utf8ToBytes,
} from './encoding.js';

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('encoding', () => {
  it('decodes base58 with leading zeros', () => {
    expect(new TextDecoder().decode(base58ToBytes('2NEpo7TZRRrLZSi2U'))).toBe('Hello World!');
    expect([...base58ToBytes('1112')]).toEqual([0, 0, 0, 1]);
    expect(hex(base58ToBytes('So11111111111111111111111111111111111111112'))).toBe(
      '069b8857feab8184fb687f634618c035dac439dc1aeb3b5598a0f00000000001',
    );
    expect(() => base58ToBytes('0OIl')).toThrow('Invalid base58');
  });

  it('round-trips base64', () => {
    const bytes = new Uint8Array([0, 1, 254, 255, 128]);
    expect(bytesToBase64(bytes)).toBe('AAH+/4A=');
    expect(base64ToBytes('AAH+/4A=')).toEqual(bytes);
    expect(bytesToBase64(utf8ToBytes('é'))).toBe('w6k=');
  });

  it('converts hex quantities', () => {
    expect(hexToDecimalString('0xde0b6b3a7640000')).toBe('1000000000000000000');
    expect(() => hexToDecimalString('12')).toThrow();
    expect(toHexQuantity(8453)).toBe('0x2105');
    expect(isHex('0xabc')).toBe(true);
    expect(isHex('hello')).toBe(false);
  });
});
