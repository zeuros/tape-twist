import type { BrowserContext, CDPSession, Page } from 'playwright'
import type { Platform } from '#shared/types/music'

/**
 * The login browser, shown in the player: the server's own Chromium tab is streamed as JPEG
 * frames (Chrome's screencast, sent only when the page changes) and the phone's taps, scrolls
 * and typing are replayed into it. Deezer and SoundCloud can't be shown in an iframe, and a
 * page couldn't read their cookies anyway; this way the capture (server/utils/capture.ts)
 * stays on the server, unchanged. A popup (Google / Apple sign-in) takes over the view until
 * it closes.
 */

export type ViewEvent =
  | { type: 'frame'; data: string; w: number; h: number }
  | { type: 'end'; ok: boolean; message: string }

export type ViewInput =
  | { type: 'click'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: string }

/** The keys the phone's keyboard can't send as text. */
const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Backspace: { code: 'Backspace', vk: 8 },
  Tab: { code: 'Tab', vk: 9 },
  Escape: { code: 'Escape', vk: 27 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
}

class RemoteView {
  private subs = new Set<(e: ViewEvent) => void>()
  private last: ViewEvent | null = null
  private cdp: CDPSession | null = null
  private page: Page | null = null
  private pages: Page[] = []
  ended = false

  constructor(
    private ctx: BrowserContext,
    private size: { width: number; height: number; dpr: number },
  ) {
    ctx.on('page', (p) => void this.show(p))
  }

  subscribe(fn: (e: ViewEvent) => void) {
    if (this.last) fn(this.last)
    this.subs.add(fn)
    return () => this.subs.delete(fn)
  }

  private emit(e: ViewEvent) {
    if (e.type === 'frame' || e.type === 'end') this.last = e
    for (const fn of this.subs) fn(e)
  }

  /** Stream this page (the newest one open: a popup comes in front, and leaves on close). */
  async show(page: Page) {
    if (this.ended || page.isClosed()) return
    if (!this.pages.includes(page)) {
      this.pages.push(page)
      page.on('close', () => {
        this.pages = this.pages.filter((p) => p !== page)
        const back = this.pages.at(-1)
        if (this.page === page && back) void this.show(back)
      })
    }
    if (this.page === page) return
    await this.cdp?.send('Page.stopScreencast').catch(() => {})
    await this.cdp?.detach().catch(() => {})
    this.page = page
    const cdp = (this.cdp = await this.ctx.newCDPSession(page))
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      if (this.cdp === cdp) this.emit({ type: 'frame', data, w: metadata.deviceWidth, h: metadata.deviceHeight })
    })
    const scale = Math.min(this.size.dpr, 2)
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: Math.round(this.size.width * scale),
      maxHeight: Math.round(this.size.height * scale),
    })
  }

  async input(i: ViewInput): Promise<{ editable: boolean } | void> {
    const cdp = this.cdp
    if (!cdp || this.ended) return
    const send = (method: any, params: any) => cdp.send(method, params)
    switch (i.type) {
      case 'move':
        return send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: i.x, y: i.y })
      case 'click':
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: i.x, y: i.y })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: i.x, y: i.y, button: 'left', clickCount: 1 })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: i.x, y: i.y, button: 'left', clickCount: 1 })
        return { editable: await this.editableFocused() }
      case 'wheel':
        return send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: i.x, y: i.y, deltaX: i.dx, deltaY: i.dy })
      case 'text':
        return send('Input.insertText', { text: i.text })
      case 'key': {
        const k = KEYS[i.key]
        if (!k) return
        const base = { key: i.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk }
        await send('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...base, text: k.text })
        return send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
      }
    }
  }

  /** A text field has the focus (the phone keeps its keyboard open). Inside an iframe: assume so. */
  private async editableFocused() {
    return (await this.page
      ?.evaluate(() => {
        const e = document.activeElement as HTMLElement | null
        return !!e && (e.isContentEditable || /^(INPUT|TEXTAREA|SELECT|IFRAME)$/.test(e.tagName))
      })
      .catch(() => false)) ?? false
  }

  end(ok: boolean, message: string) {
    if (this.ended) return
    this.ended = true
    this.emit({ type: 'end', ok, message })
    void this.cdp?.detach().catch(() => {})
    this.cdp = null
  }
}

const views: Partial<Record<Platform, RemoteView>> = {}

export function openView(p: Platform, ctx: BrowserContext, size: { width: number; height: number; dpr: number }) {
  views[p]?.end(false, 'Replaced by a new login')
  return (views[p] = new RemoteView(ctx, size))
}
export const getView = (p: Platform) => views[p] ?? null
