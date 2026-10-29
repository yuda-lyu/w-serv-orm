import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'


//R-DIAG-01(orm-run01): 真ORM(w-orm-lowdb)加失敗注入, 於子行程實跑 WServOrm, 由父行程檢查子行程「真實的 stdout 與 stderr」
//(單元測試以替換 console.log 擷取, 此處驗證行程標準輸出本身, 即 pm2 與容器 log 所收集者; 失敗只在使用者識別為 SECRET 之列發生, 其餘列照常寫入真資料庫)
//insert、save、del 與 mix 各一條失敗路徑; 預設時 stdout 與 stderr 皆不得出現 SECRET 與ORM錯誤原文, logDetail 為 true 時出現(正對照), funLog 時 console 無診斷輸出而 funLog 收完整細節
let SECRET = 'u-secret@example.com'
let ERRTXT = 'E-raw-9f3a duplicate key'
let fd = path.resolve('./test/_tmp/api-diaglog')
let urlSrv = pathToFileURL(path.resolve('./src/WServOrm.mjs')).href
let urlDs = pathToFileURL(path.resolve('./schema/index.mjs')).href

let CHILD = `
import fs from 'fs'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import ds from '${urlDs}'
import WServOrm from '${urlSrv}'

let SECRET = '${SECRET}'
let ERRTXT = '${ERRTXT}'
let dir = process.argv[2]
let mode = process.argv[3]
let funs = []
let opt = undefined
if (mode === 'detail') {
    opt = { logDetail: true }
}
if (mode === 'fun') {
    opt = { funLog: (...a) => { funs.push(a) } }
}

//真ORM外包一層: 只有 id 為 SECRET 之列失敗(insert 整批 reject, save 與 del 該筆 ok 為 0 並附含使用者識別之 err), 其餘列照常由真ORM寫入
function WOrmInject(...args) {
    let wo = WOrm(...args)
    let rowsOf = (d) => (Array.isArray(d) ? d : [d])
    let insertOrig = wo.insert
    wo.insert = async (d) => {
        if (rowsOf(d).some((v) => v.id === SECRET)) {
            throw new Error(ERRTXT + ' id=' + SECRET)
        }
        return insertOrig(d)
    }
    for (let m of ['save', 'del']) {
        let orig = wo[m]
        wo[m] = async (d) => {
            let rows = rowsOf(d)
            let good = rows.filter((v) => v.id !== SECRET)
            let rs = good.length > 0 ? await orig(good) : []
            let k = 0
            return rows.map((v) => (v.id === SECRET ? { n: 1, ok: 0, err: ERRTXT + ' id=' + SECRET } : rs[k++]))
        }
    }
    return wo
}

let so = WServOrm(ds, WOrmInject, dir + '/db.json', 'worm', opt)
let out = {}
let run = async (name, p) => {
    try {
        out[name] = { resolve: await p }
    }
    catch (e) {
        out[name] = { reject: e }
    }
}
await run('insert', so.procOrm('u1', 'tests', 'insert', [{ id: SECRET, isActive: 'y' }]))
await run('save', so.procOrm('u1', 'tests', 'save', [{ id: 'ok-1', isActive: 'y' }, { id: SECRET, isActive: 'y' }]))
await run('del', so.procOrm('u1', 'tests', 'del', [{ id: 'ok-1' }, { id: SECRET }]))
await run('mix', so.procOrm('u1', 'tests', 'mix', { add: [{ id: 'ok-2', isActive: 'y' }], diff: [{ id: SECRET, isActive: 'n' }] }))
out.rows = (await so.woItems.tests.select({})).map((v) => v.id)
out.funs = funs
await so.closeAll()
fs.writeFileSync(dir + '/out.json', JSON.stringify(out), 'utf8')
`

//工具路徑與建構之無效參數(外審 terra F01、F02、F03、F18): 各函數皆帶使用者識別或密碼之無效值, 檢查真實 stdout 與 stderr
let urlGetDb = pathToFileURL(path.resolve('./src/getDb.mjs')).href
let urlSettings = pathToFileURL(path.resolve('./src/getSettings.mjs')).href
let urlGen = pathToFileURL(path.resolve('./src/genTestData.mjs')).href
let PASS = 'p4ss-W0rd-secret'
let CHILD_TOOLS = `
import fs from 'fs'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import ds from '${urlDs}'
import WServOrm from '${urlSrv}'
import getDb from '${urlGetDb}'
import getSettings from '${urlSettings}'
import genTestData from '${urlGen}'

let SECRET = '${SECRET}'
let PASS = '${PASS}'
let dir = process.argv[2]
let mode = process.argv[3]
let funs = []
let opt = {}
if (mode === 'detail') {
    opt = { logDetail: true }
}
if (mode === 'fun') {
    opt = { funLog: (...a) => { funs.push(a) } }
}
let out = {}
let run = async (name, f) => {
    try {
        out[name] = { resolve: await f() }
    }
    catch (e) {
        out[name] = { reject: String(e && e.message) }
    }
}
fs.writeFileSync(dir + '/bk.json', JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
fs.writeFileSync(dir + '/settings-bad.json', JSON.stringify(Object.fromEntries([['dbType', 'mongodb'], [SECRET, 'x'], ['dbPassword', PASS]])), 'utf8')
await run('settingsMissing', async () => getSettings({ ...opt, fn: dir + '/missing-' + SECRET + '.json' }))
await run('settingsBad', async () => getSettings({ ...opt, fn: dir + '/settings-bad.json' }))
await run('dsInvalid', async () => WServOrm(SECRET, WOrm, 'u', 'd', opt))
await run('urlInvalid', async () => WServOrm(ds, WOrm, { password: PASS, user: SECRET }, 'd', opt))
await run('recoverFp', async () => getDb.recover({ tests: {} }, dir + '/' + SECRET + '.json', { bLog: false, ...opt }))
await run('recoverWoItems', async () => getDb.recover(SECRET, dir + '/bk.json', { bLog: false, ...opt }))
await run('backupWoItems', async () => getDb.backup(SECRET, { bLog: false, ...opt }))
await run('gen', async () => genTestData({ tests: { funTest: async () => [{ id: SECRET, name: PASS }] } }, { tests: { save: async (d) => d.map(() => ({ n: 1, ok: 1 })) } }, { mode: 'funTest', ...opt }))
out.funs = funs
fs.writeFileSync(dir + '/out.json', JSON.stringify(out), 'utf8')
`

function runChild(mode, kind = 'main') {
    let dir = path.join(fd, kind + '-' + mode)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    let fp = path.join(dir, 'run.mjs')
    fs.writeFileSync(fp, kind === 'tools' ? CHILD_TOOLS : CHILD, 'utf8')
    let r = spawnSync(process.execPath, [fp, dir, mode], { cwd: dir, encoding: 'utf8', windowsHide: true })
    let out = fs.existsSync(path.join(dir, 'out.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'out.json'), 'utf8')) : null
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, out }
}

//契約: reject值與真資料庫狀態不因診斷選項而變(ok-1 先寫入再刪除, ok-2 由 mix 新增; SECRET 之列皆失敗)
let CONTRACT = {
    insert: { reject: 'failed to insert data' },
    save: { reject: `failed to save data: id[${SECRET}]` },
    del: { reject: `failed to delete data: id[${SECRET}]` },
    mix: { reject: `failed to update data: id[${SECRET}]` },
    rows: ['ok-2'],
}


describe('診斷輸出之行程標準輸出(真w-orm-lowdb, 子行程; R-DIAG-01)', function() {

    this.timeout(120000)

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('A01 預設: stdout與stderr皆不含使用者識別與ORM錯誤原文, 仍有標籤與摘要; 回傳契約與資料庫狀態不變', function() {
        //R-DIAG-01 規則1、4(來源: w-web-perm 建議書「stdout 無從遮罩」): insert、save、del、mix 四條失敗路徑
        let r = runChild('default')
        assert.strict.equal(r.status, 0, r.stderr)
        let all = r.stdout + r.stderr
        assert.ok(!all.includes(SECRET), `行程輸出含使用者識別:\n${all}`)
        assert.ok(!all.includes(ERRTXT), `行程輸出含ORM錯誤原文:\n${all}`)
        for (let label of ['tests.insert catch', 'tests.save fail', 'tests.del fail']) {
            assert.ok(r.stdout.includes(label), `${label}\n${r.stdout}`)
        }
        assert.strict.equal(r.stdout.split('tests.save fail').length - 1, 2, 'save與mix之diff各一') //mix之diff失敗亦標為 tests.save fail
        assert.ok(r.stdout.includes('errType'))
        assert.ok(r.stdout.includes('ks: [ 1 ]')) //save與del之失敗列位於第1筆
        assert.strict.deepEqual({ ...r.out, funs: undefined }, { ...CONTRACT, funs: undefined })
    })

    it('A02 logDetail為true: 還原舊輸出(stdout含使用者識別與原文), 回傳契約與資料庫狀態不變', function() {
        //R-DIAG-01 規則3: 正對照, 證明A01之不含並非因為路徑沒走到
        let r = runChild('detail')
        assert.strict.equal(r.status, 0, r.stderr)
        assert.ok(r.stdout.includes(SECRET) && r.stdout.includes(ERRTXT), r.stdout)
        assert.ok(r.stdout.includes(`id: '${SECRET}'`), '逐筆失敗列之 {k, id, err}')
        assert.strict.deepEqual({ ...r.out, funs: undefined }, { ...CONTRACT, funs: undefined })
    })

    it('A03 funLog: 行程輸出無診斷, funLog收到含使用者識別與原文之完整細節, 回傳契約與資料庫狀態不變', function() {
        //R-DIAG-01 規則3: 使用端經funLog遮罩或轉送
        let r = runChild('fun')
        assert.strict.equal(r.status, 0, r.stderr)
        assert.strict.equal((r.stdout + r.stderr).includes('tests.'), false, r.stdout + r.stderr)
        assert.strict.deepEqual(r.out.funs.map((v) => v[0]), ['tests.insert catch', 'tests.save fail', 'tests.del fail', 'tests.save fail'])
        let text = JSON.stringify(r.out.funs)
        assert.ok(text.includes(SECRET) && text.includes(ERRTXT), text)
        assert.strict.deepEqual({ ...r.out, funs: undefined }, { ...CONTRACT, funs: undefined })
    })

    //工具路徑與建構之契約: 各情形之拋錯訊息為固定句型(不含呼叫端傳入之值), 不因診斷選項而變
    let CONTRACT_TOOLS = {
        settingsMissing: { reject: 'failed to read settings file' },
        settingsBad: { reject: 'failed to read settings file' },
        dsInvalid: { reject: 'invalid ds' },
        urlInvalid: { reject: 'invalid url' },
        recoverFp: { reject: 'fp is not exist' },
        recoverWoItems: { reject: 'invalid woItems' },
        backupWoItems: { reject: 'invalid woItems' },
        gen: {}, //resolve undefined, JSON序列化後無鍵
    }

    it('A04 工具路徑與建構之無效參數(預設): stdout與stderr皆不含呼叫端傳入之識別、密碼與路徑; 拋錯訊息不變', function() {
        //R-DIAG-01 規則1、4(外審 terra F01、F02、F03): 設定檔路徑、ds、url(含密碼)、備份檔路徑、woItems、測試資料列
        let r = runChild('default', 'tools')
        assert.strict.equal(r.status, 0, r.stderr)
        let all = r.stdout + r.stderr
        assert.ok(!all.includes(SECRET), `行程輸出含使用者識別:\n${all}`)
        assert.ok(!all.includes(PASS), `行程輸出含密碼:\n${all}`)
        for (let line of ['getSettings catch { errType: \'Error\', errCode: \'ENOENT\' }', 'st { keys: [ \'dbType\', \'dbPassword\' ], nOther: 1 }', 'getSettings catch { errType: \'Error\' }', 'ds { type: \'string\' }', 'url { type: \'object\' }', 'fp { type: \'string\' }', 'woItems { type: \'string\' }', 'recover catch { errType: \'Error\' }', 'backup catch { errType: \'Error\' }', 'tests.funTest and save { n: 1 }']) {
            assert.ok(r.stdout.split(/\r?\n/).includes(line), `${line}\n${r.stdout}`)
        }
        assert.strict.deepEqual({ ...r.out, funs: undefined }, { ...CONTRACT_TOOLS, funs: undefined })
    })

    it('A05 工具路徑與建構之無效參數(logDetail): stdout含傳入之值(識別、資料值), 但憑證(設定檔之dbPassword、憑證鍵名之值)遮罩; 拋錯訊息不變', function() {
        //R-DIAG-01 規則3: 正對照; 2026-10-29 mig-servorm起細節為wsemi之遮罩拷貝(dspec D2: 細節遮罩憑證, 識別值不遮)
        let r = runChild('detail', 'tools')
        assert.strict.equal(r.status, 0, r.stderr)
        assert.ok(r.stdout.includes(SECRET), r.stdout)
        let lines = r.stdout.split(/\r?\n/)
        let st = lines.find((v) => v.startsWith('st '))
        let url = lines.find((v) => v.startsWith('url '))
        let gen = lines.find((v) => v.startsWith('tests.funTest and save '))
        assert.ok(st.includes('dbPassword: \'***\'') && !st.includes(PASS), st)
        assert.ok(url.includes('password: \'***\'') && url.includes(SECRET) && !url.includes(PASS), url)
        assert.ok(gen.includes(PASS), `資料列之欄位值(非憑證)不遮: ${gen}`)
        assert.strict.deepEqual({ ...r.out, funs: undefined }, { ...CONTRACT_TOOLS, funs: undefined })
    })

    it('A06 工具路徑與建構之無效參數(funLog): 行程輸出無任何診斷, funLog收型別摘要與遮罩後之細節', function() {
        //R-DIAG-01 規則3: funLog給予時本套件不寫console(含進度、無效參數、設定檔錯誤); 細節之憑證遮罩同A05
        let r = runChild('fun', 'tools')
        assert.strict.equal(r.status, 0, r.stderr)
        assert.strict.equal(r.stdout + r.stderr, '', r.stdout + r.stderr)
        assert.strict.deepEqual(r.out.funs.map((v) => v[0]), ['getSettings catch', 'st', 'getSettings catch', 'ds', 'url', 'fp', 'recover catch', 'woItems', 'recover catch', 'woItems', 'backup catch', 'tests.funTest and save'])
        let byLabel = (lb) => r.out.funs.find((v) => v[0] === lb)
        assert.strict.equal(byLabel('st')[2].dbPassword, '***')
        assert.deepStrictEqual(byLabel('url')[2], { password: '***', user: SECRET })
        assert.deepStrictEqual(byLabel('tests.funTest and save')[2], [{ id: SECRET, name: PASS }], '資料列之欄位值(非憑證)不遮')
        assert.strict.deepEqual({ ...r.out, funs: undefined }, { ...CONTRACT_TOOLS, funs: undefined })
    })

})
