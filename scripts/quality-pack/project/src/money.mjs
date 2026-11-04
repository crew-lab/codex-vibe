export function percentOf(cents, percent) {
  return Math.round((cents * percent) / 100);
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
