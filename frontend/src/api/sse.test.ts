import { describe, expect, it } from 'vitest';
import { SseParser } from './sse';

describe('SseParser', () => {
  it('reassembles events split across chunks, even mid multibyte text', () => {
    const parser = new SseParser();
    expect(parser.push('event: tok')).toEqual([]);
    expect(parser.push('en\ndata: {"text":"қ"}\n')).toEqual([]);
    expect(parser.push('\nevent: done\ndata: {}\n\n')).toEqual([
      { event: 'token', data: '{"text":"қ"}' },
      { event: 'done', data: '{}' },
    ]);
  });
  it('handles CRLF, comments and multi-line data', () => {
    expect(new SseParser().push(': ping\r\nevent: x\r\ndata: a\r\ndata: b\r\n\r\n')).toEqual([{ event: 'x', data: 'a\nb' }]);
  });
  it('ignores blocks with no data', () => {
    expect(new SseParser().push(': keepalive\n\n')).toEqual([]);
  });
});
