export const BASE_62_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function midpoint(a: string, b: string | null, digits: string): string {
  const zero = digits.charAt(0);
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === zero || (b !== null && b.slice(-1) === zero)) throw new Error("trailing zero");
  if (b !== null) {
    let n = 0;
    while ((a.charAt(n) || zero) === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n), digits);
  }
  const digitA = a ? digits.indexOf(a.charAt(0)) : 0;
  const digitB = b !== null ? digits.indexOf(b.charAt(0)) : digits.length;
  if (digitB - digitA > 1) return digits.charAt(Math.round(0.5 * (digitA + digitB)));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return digits.charAt(digitA) + midpoint(a.slice(1), null, digits);
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}

function validateInteger(integer: string): void {
  if (integer.length !== integerLength(integer.charAt(0))) {
    throw new Error(`invalid integer part of order key: ${integer}`);
  }
}

function integerPart(key: string): string {
  const length = integerLength(key.charAt(0));
  if (length > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, length);
}

function smallestInteger(digits: string): string {
  return `A${digits.charAt(0).repeat(26)}`;
}

export function validateOrderKey(key: string, digits = BASE_62_DIGITS): void {
  if (key === smallestInteger(digits)) throw new Error(`invalid order key: ${key}`);
  const integer = integerPart(key);
  if (key.slice(integer.length).slice(-1) === digits.charAt(0)) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(value: string, digits: string): string | null {
  validateInteger(value);
  const head = value.charAt(0);
  const rest = value.slice(1).split("");
  let carry = true;
  for (let index = rest.length - 1; carry && index >= 0; index--) {
    const next = digits.indexOf(rest[index] ?? "") + 1;
    if (next === digits.length) {
      rest[index] = digits.charAt(0);
    } else {
      rest[index] = digits.charAt(next);
      carry = false;
    }
  }
  if (!carry) return head + rest.join("");
  if (head === "Z") return `a${digits.charAt(0)}`;
  if (head === "z") return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > "a") rest.push(digits.charAt(0));
  else rest.pop();
  return nextHead + rest.join("");
}

function decrementInteger(value: string, digits: string): string | null {
  validateInteger(value);
  const head = value.charAt(0);
  const rest = value.slice(1).split("");
  let borrow = true;
  for (let index = rest.length - 1; borrow && index >= 0; index--) {
    const previous = digits.indexOf(rest[index] ?? "") - 1;
    if (previous === -1) {
      rest[index] = digits.slice(-1);
    } else {
      rest[index] = digits.charAt(previous);
      borrow = false;
    }
  }
  if (!borrow) return head + rest.join("");
  if (head === "a") return `Z${digits.slice(-1)}`;
  if (head === "A") return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < "Z") rest.push(digits.slice(-1));
  else rest.pop();
  return previousHead + rest.join("");
}

export function generateKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  digits = BASE_62_DIGITS,
): string {
  const lower = a ?? null;
  const upper = b ?? null;
  if (lower !== null) validateOrderKey(lower, digits);
  if (upper !== null) validateOrderKey(upper, digits);
  if (lower !== null && upper !== null && lower >= upper) throw new Error(`${lower} >= ${upper}`);
  if (lower === null) {
    if (upper === null) return `a${digits.charAt(0)}`;
    const integer = integerPart(upper);
    const fraction = upper.slice(integer.length);
    if (integer === smallestInteger(digits)) return integer + midpoint("", fraction, digits);
    if (integer < upper) return integer;
    const decremented = decrementInteger(integer, digits);
    if (decremented === null) throw new Error("cannot decrement any more");
    return decremented;
  }
  if (upper === null) {
    const integer = integerPart(lower);
    const fraction = lower.slice(integer.length);
    const incremented = incrementInteger(integer, digits);
    return incremented === null ? integer + midpoint(fraction, null, digits) : incremented;
  }
  const integerA = integerPart(lower);
  const fractionA = lower.slice(integerA.length);
  const integerB = integerPart(upper);
  const fractionB = upper.slice(integerB.length);
  if (integerA === integerB) return integerA + midpoint(fractionA, fractionB, digits);
  const incremented = incrementInteger(integerA, digits);
  if (incremented === null) throw new Error("cannot increment any more");
  if (incremented < upper) return incremented;
  return integerA + midpoint(fractionA, null, digits);
}

export function generateNKeysBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  n: number,
  digits = BASE_62_DIGITS,
): string[] {
  const lower = a ?? null;
  const upper = b ?? null;
  if (n === 0) return [];
  if (n === 1) return [generateKeyBetween(lower, upper, digits)];
  if (upper === null) {
    let current = generateKeyBetween(lower, upper, digits);
    const keys = [current];
    for (let index = 0; index < n - 1; index++) {
      current = generateKeyBetween(current, upper, digits);
      keys.push(current);
    }
    return keys;
  }
  if (lower === null) {
    let current = generateKeyBetween(lower, upper, digits);
    const keys = [current];
    for (let index = 0; index < n - 1; index++) {
      current = generateKeyBetween(lower, current, digits);
      keys.push(current);
    }
    return keys.reverse();
  }
  const half = Math.floor(n / 2);
  const middle = generateKeyBetween(lower, upper, digits);
  return [
    ...generateNKeysBetween(lower, middle, half, digits),
    middle,
    ...generateNKeysBetween(middle, upper, n - half - 1, digits),
  ];
}
