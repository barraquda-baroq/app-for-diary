// ハッシュの行き先（#/week/2026-11-08 など）の読み書き（docs/SPEC.md の 3.1）。react-router の createHashHistory と同じ読み方・
// 作り方で、履歴の state は { usr, key, idx } の形。アプリの履歴の2つの形（src/history/appHistory.ts の AppHistory = Android・PC の
// 印の履歴、src/history/singleEntryHistory.ts の SingleEntryHistory = iPhone・iPad の1つの履歴）が同じ物を使う
import { createPath, parsePath, type Location, type RouterInit } from 'react-router-dom'

export type RouterHistory = RouterInit['history']
export type Update = Parameters<Parameters<RouterHistory['listen']>[0]>[0]
export type Listener = (update: Update) => void
export type To = Parameters<RouterHistory['push']>[0]

/** 行き先を読む・作るのに使う window の物 */
export interface HashWindow {
  history: { readonly state: unknown }
  location: { readonly href: string; readonly hash: string; readonly origin: string }
  document: { querySelector(selector: string): { getAttribute(name: string): string | null } | null }
}

/** 履歴の state の DS の印（Android・PC の印の履歴。前の版の iPhone も） */
export interface Meta {
  /** 土台（カレンダーを置く履歴）の idx */
  base: number
  /** 印の履歴（back = 土台の前、fwd = 土台・積んだ画面の後ろ） */
  mark?: 'back' | 'fwd'
}

/** 履歴の state（react-router の形に ds を足した物） */
export interface EntryState {
  usr?: unknown
  key?: string
  idx?: number
  ds?: Meta
}

export function stateOf(value: unknown): EntryState | null {
  return value && typeof value === 'object' ? (value as EntryState) : null
}

export function metaOf(value: unknown): Meta | null {
  const ds = stateOf(value)?.ds
  return ds && typeof ds === 'object' && typeof ds.base === 'number' ? ds : null
}

/** react-router と同じ形の key */
export function makeKey(): string {
  return Math.random().toString(36).substring(2, 10)
}

const PROTOCOL_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** ルーターが渡す行き先か（key を持つ物） */
export function isLocation(to: unknown): to is Location {
  return Boolean(to && typeof to === 'object' && typeof (to as Location).key === 'string')
}

/** 今の window の行き先（react-router の createHashHistory と同じ読み方） */
export function readHashLocation(win: HashWindow): Location {
  const parsed = parsePath(win.location.hash.substring(1))
  let pathname = parsed.pathname ?? '/'
  if (!pathname.startsWith('/') && !pathname.startsWith('.')) pathname = `/${pathname}`
  const st = stateOf(win.history.state)
  return { pathname, search: parsed.search ?? '', hash: parsed.hash ?? '', state: st?.usr ?? null, key: st?.key ?? 'default' }
}

/** ルーターが渡した行き先（key の無い物は、今の行き先 pathname から作って新しい key を付ける） */
export function toLocation(to: To, state: unknown, pathname: string): Location {
  if (isLocation(to)) return to
  const parts = typeof to === 'string' ? parsePath(to) : to
  return { pathname, search: '', hash: '', ...parts, state: state ?? null, key: makeKey() }
}

/** 行き先の href（#/…。<base href> があれば、今の URL の # の前に付ける） */
export function hashHref(win: HashWindow, to: To): string {
  const base = win.document.querySelector('base')
  let href = ''
  if (base && base.getAttribute('href')) {
    const url = win.location.href
    const hashIndex = url.indexOf('#')
    href = hashIndex === -1 ? url : url.slice(0, hashIndex)
  }
  return `${href}#${typeof to === 'string' ? to : createPath(to)}`
}

export function hashURL(win: HashWindow, to: To): URL {
  const origin = win.location.origin !== 'null' ? win.location.origin : win.location.href
  let href = (typeof to === 'string' ? to : createPath(to)).replace(/ $/, '%20')
  if (PROTOCOL_RELATIVE.test(href)) href = origin + href
  return new URL(href, origin)
}

export function encodeHashLocation(win: HashWindow, to: To): { pathname: string; search: string; hash: string } {
  const url = hashURL(win, to)
  return { pathname: url.pathname, search: url.search, hash: url.hash }
}
