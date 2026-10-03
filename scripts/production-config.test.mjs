import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./production-config.mjs', import.meta.url))
const jwt = role => `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.testsignature`
const run = (url, key) => spawnSync(process.execPath, [script], { encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } })

test('production gate accepts public keys without printing their values', () => {
  for (const key of ['sb_publishable_TEST_ONLY', jwt('anon')]) {
    const result = run('https://example-project.supabase.co', key)
    assert.equal(result.status, 0)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(key))
  }
})
test('production gate blocks privileged credentials and redacts them', () => {
  for (const key of ['sb_secret_TEST_ONLY', jwt('service_role'), 'sbp_TEST_ONLY', 'not-a-key']) {
    const result = run('https://example-project.supabase.co', key)
    assert.equal(result.status, 1)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(key))
  }
})
test('production gate stops deployment when configuration is missing', () => {
  assert.equal(run('', '').status, 1)
})
test('production gate rejects localhost and URLs carrying credentials', () => {
  for (const url of ['http://localhost:54321', 'https://127.0.0.1', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?secret=TEST_ONLY']) {
    const result = run(url, 'sb_publishable_TEST_ONLY')
    assert.equal(result.status, 1)
    assert.ok(!`${result.stdout}${result.stderr}`.includes(url))
  }
})
