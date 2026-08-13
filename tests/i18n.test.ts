import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setLocale, getLocale, t } from '../src/i18n.ts'

test('i18n: explicit preference wins', () => {
  setLocale('zh')
  assert.equal(getLocale(), 'zh')
  assert.equal(t('status.empty'), '尚无任何 deepjit 产物。')
  setLocale('en')
  assert.equal(getLocale(), 'en')
  assert.equal(t('status.empty'), 'No deepjit artifacts yet.')
})

test('i18n: placeholder substitution', () => {
  setLocale('en')
  assert.equal(t('status.unknown', { name: 'deepjit-x' }), 'unknown artifact "deepjit-x"')
  setLocale('zh')
  assert.equal(t('status.unknown', { name: 'deepjit-x' }), '未知产物 "deepjit-x"')
  setLocale('en')
})

test('i18n: auto falls back to environment then English', () => {
  const savedLang = process.env.LANG
  const savedLcAll = process.env.LC_ALL
  try {
    delete process.env.LC_ALL
    process.env.LANG = 'zh_CN.UTF-8'
    setLocale('auto')
    assert.equal(getLocale(), 'zh')

    process.env.LANG = 'en_US.UTF-8'
    setLocale('auto')
    assert.equal(getLocale(), 'en')
  } finally {
    if (savedLang === undefined) delete process.env.LANG
    else process.env.LANG = savedLang
    if (savedLcAll === undefined) delete process.env.LC_ALL
    else process.env.LC_ALL = savedLcAll
    setLocale('en')
  }
})

test('i18n: dsh locale takes precedence over environment under auto', () => {
  const savedLang = process.env.LANG
  try {
    process.env.LANG = 'zh_CN.UTF-8'
    setLocale('auto', 'en')
    assert.equal(getLocale(), 'en')
  } finally {
    if (savedLang === undefined) delete process.env.LANG
    else process.env.LANG = savedLang
    setLocale('en')
  }
})
