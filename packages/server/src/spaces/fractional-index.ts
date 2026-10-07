const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;
const ZERO = DIGITS[0] as string;
const FIRST_INTEGER = "a0";
const SMALLEST_INTEGER = `A${ZERO.repeat(26)}`;

export class PositionError extends Error {
  override name = "PositionError";
}

function digit(char: string | undefined): number {
  const value = char === undefined ? -1 : DIGITS.indexOf(char);
  if (value < 0) throw new PositionError(`Invalid position digit ${char ?? "(none)"}`);
  return value;
}

function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - "a".charCodeAt(0) + 2;
  if (head >= "A" && head <= "Z") return "Z".charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new PositionError(`Invalid position head ${head}`);
}

function integerPart(position: string): string {
  const length = integerLength(position[0] ?? "");
  if (length > position.length) throw new PositionError(`Position ${position} is too short`);
  return position.slice(0, length);
}

export function isValidPosition(position: string): boolean {
  try {
    if (position.length === 0 || position.length > 10_000) return false;
    const integer = integerPart(position);
    for (const char of position.slice(1)) digit(char);
    if (integer === SMALLEST_INTEGER) return false;
    const fraction = position.slice(integer.length);
    return !fraction.endsWith(ZERO);
  } catch {
    return false;
  }
}

function between(lower: string, upper: string | null): string {
  if (upper !== null && lower >= upper) throw new PositionError(`${lower} is not below ${upper}`);
  if (lower.endsWith(ZERO) || upper?.endsWith(ZERO)) throw new PositionError("Trailing zero");
  if (upper !== null) {
    let shared = 0;
    while ((lower[shared] ?? ZERO) === upper[shared]) shared++;
    if (shared > 0) return upper.slice(0, shared) + between(lower.slice(shared), upper.slice(shared));
  }
  const low = lower.length > 0 ? digit(lower[0]) : 0;
  const high = upper !== null ? digit(upper[0]) : BASE;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)] as string;
  if (upper !== null && upper.length > 1) return upper.slice(0, 1);
  return (DIGITS[low] as string) + between(lower.slice(1), null);
}

function step(integer: string, direction: 1 | -1): string | null {
  const head = integer[0] as string;
  const digits = [...integer.slice(1)];
  let carry = true;
  for (let index = digits.length - 1; carry && index >= 0; index--) {
    const next = digit(digits[index]) + direction;
    if (next === BASE) digits[index] = ZERO;
    else if (next === -1) digits[index] = DIGITS[BASE - 1] as string;
    else {
      digits[index] = DIGITS[next] as string;
      carry = false;
    }
  }
  if (!carry) return head + digits.join("");
  if (direction === 1) {
    if (head === "Z") return FIRST_INTEGER;
    if (head === "z") return null;
    const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
    if (nextHead > "a") digits.push(ZERO);
    else digits.pop();
    return nextHead + digits.join("");
  }
  if (head === "a") return `Z${DIGITS[BASE - 1]}`;
  if (head === "A") return null;
  const previousHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (previousHead < "Z") digits.push(DIGITS[BASE - 1] as string);
  else digits.pop();
  return previousHead + digits.join("");
}

export function positionBetween(lower: string | null, upper: string | null): string {
  if (lower !== null && !isValidPosition(lower)) throw new PositionError(`Invalid position ${lower}`);
  if (upper !== null && !isValidPosition(upper)) throw new PositionError(`Invalid position ${upper}`);
  if (lower !== null && upper !== null && lower >= upper) {
    throw new PositionError(`${lower} is not below ${upper}`);
  }
  if (lower === null && upper === null) return FIRST_INTEGER;
  if (lower === null) {
    const integer = integerPart(upper as string);
    const fraction = (upper as string).slice(integer.length);
    if (integer === SMALLEST_INTEGER) return integer + between("", fraction);
    if (integer < (upper as string)) return integer;
    const previous = step(integer, -1);
    if (previous === null) throw new PositionError("No position below the smallest position");
    return previous;
  }
  const integer = integerPart(lower);
  const fraction = lower.slice(integer.length);
  if (upper === null) {
    const next = step(integer, 1);
    return next ?? integer + between(fraction, null);
  }
  const upperInteger = integerPart(upper);
  if (integer === upperInteger) return integer + between(fraction, upper.slice(upperInteger.length));
  const next = step(integer, 1);
  if (next === null) throw new PositionError("No position above the largest position");
  return next < upper ? next : integer + between(fraction, null);
}
