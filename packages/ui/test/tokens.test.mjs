import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../src/tokens.css', import.meta.url), 'utf8');
const color = name => {
  const value = css.match(new RegExp(`--ks-color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
  assert.ok(value, `Missing color token: ${name}`);
  return value;
};
const luminance = hex => {
  const channels = hex.slice(1).match(/.{2}/g).map(channel => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (first, second) => {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

test('design-system text colors remain readable on their surfaces', () => {
  for (const [foreground, background] of [['ink', 'brand'], ['ink', 'surface'], ['brand-strong', 'surface'], ['text-muted', 'surface']]) {
    assert.ok(contrast(color(foreground), color(background)) >= 4.5, `${foreground} on ${background} needs at least 4.5:1 contrast`);
  }
});
