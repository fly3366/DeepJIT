import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const CLIENT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'client.js')

interface Captured {
  id: string
  factory: (require: (name: string) => unknown) => {
    inject: string[]
    apply: (ctx: unknown) => void
  }
}

function loadFactory(): Captured {
  const src = readFileSync(CLIENT, 'utf8')
  let captured: Captured | undefined
  const sandbox = { window: { __ModuleLoader__: { load: (mod: Captured) => { captured = mod } } } }
  vm.runInNewContext(src, sandbox)
  assert.ok(captured, 'factory registered via window.__ModuleLoader__.load')
  return captured!
}

const reactStub = {
  createElement: (...args: unknown[]) => ({ args }),
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
}
const requireStub = (name: string) => {
  if (name === 'react') return reactStub
  throw new Error(`unexpected module request: ${name}`)
}

test('client factory: loads with the package id and declares slots/locale inject', () => {
  const captured = loadFactory()
  const mod = captured.factory(requireStub)
  assert.equal(captured.id, '@fly3366/deepjit')
  // Spread into a main-realm array: vm contexts have a different Array.prototype.
  assert.deepEqual([...mod.inject], ['slots', 'locale'])
  assert.equal(typeof mod.apply, 'function')
})

test('client factory: apply registers the locale namespace and the detail-section slot', () => {
  const mod = loadFactory().factory(requireStub)
  const locales: string[] = []
  const injected: string[] = []
  const registered: { name: string; id: string; locale?: string }[] = []
  let component: ((props: unknown) => unknown) | undefined
  const ctx = {
    effect: (fn: () => unknown) => fn(),
    locale: { register: (ns: string) => { locales.push(ns); return () => {} } },
    slots: {
      inject: (key: string, cb: () => unknown) => { injected.push(key); cb(); return () => {} },
      register: (opts: { name: string; id: string; locale?: string }, comp: (props: unknown) => unknown) => {
        registered.push(opts)
        component = comp
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  assert.deepEqual(locales, ['deepjit'])
  assert.deepEqual(injected, ['plugins.detail.section'])
  assert.equal(registered[0]!.name, 'plugins.detail.section')
  assert.equal(registered[0]!.id, 'deepjit-status')
  assert.equal(registered[0]!.locale, 'deepjit')
  assert.equal(typeof component, 'function')

  // Renders null for other plugins' subjects; renders an element for deepjit.
  assert.equal(component!({ subject: { kind: 'item', id: 'other' } }), null)
  const el = component!({ subject: { kind: 'bundle', pkg: { name: '@fly3366/deepjit' } }, t: (k: string) => k })
  assert.ok(el, 'deepjit subject renders a panel element')
})