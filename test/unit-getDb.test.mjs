import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import getDb from '../src/getDb.mjs'
import br from '../src/getDbBackupAndRecover.mjs'


//會寫出備份檔之案例以子行程執行: getDb之輸出目錄於模組載入時取cwd, 子行程之cwd設於本案暫存夾, 不寫入repo根目錄
let fd = path.resolve('./test/_tmp/unit-getDb')
let urlGetDb = pathToFileURL(path.resolve('./src/getDb.mjs')).href

function mkWoItems(log, behavior = {}) {
    return {
        tests: {
            select: async () => {
                if (behavior.select) {
                    return behavior.select()
                }
                return [{ id: 'a' }]
            },
            insert: async (d) => {
                log.push({ fn: 'insert', table: 'tests', d })
                return { n: d.length, nInserted: d.length, ok: 1 }
            },
            createStorage: async () => {
                log.push({ fn: 'createStorage', table: 'tests' })
            },
        },
    }
}

async function getReject(pm) {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('預期reject但resolve')
}

async function quiet(fn) {
    let logOrig = console.log
    console.log = () => {}
    try {
        return await fn()
    }
    finally {
        console.log = logOrig
    }
}

function writeBackup(name, content) {
    let fp = path.join(fd, name)
    fs.writeFileSync(fp, content, 'utf8')
    return fp
}

function runChild(name, code) {
    let dir = path.join(fd, name)
    fs.mkdirSync(dir, { recursive: true })
    let fp = path.join(dir, 'run.mjs')
    fs.writeFileSync(fp, code, 'utf8')
    let r = spawnSync(process.execPath, [fp], { cwd: dir, encoding: 'utf8' })
    let files = fs.readdirSync(dir).filter((v) => v.startsWith('backup-'))
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, dir, files }
}


describe('getDb備份與還原', function() {

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('B01 backup之select失敗即reject', async function() {
        //D5: 印log後reject原錯誤
        let woItems = mkWoItems([], { select: () => Promise.reject(new Error('E-select')) })
        let err = await quiet(() => getReject(getDb.backup(woItems, { bLog: false })))
        assert.ok(String(err).includes('E-select'))
    })

    it('B02 recover之備份檔不存在即reject', async function() {
        //D5
        let err = await quiet(() => getReject(getDb.recover(mkWoItems([]), path.join(fd, 'none.json'), { bLog: false })))
        assert.ok(String(err).includes('fp is not exist'))
    })

    it('B03 recover之備份內容無效即reject且不寫入', async function() {
        //P4-2: 空檔、壞JSON、空陣列、缺name皆拒絕, 不假成功
        for (let [name, content] of [['empty.json', ''], ['bad.json', '{bad'], ['arr0.json', '[]'], ['noname.json', '[{"x":1}]']]) {
            let log = []
            let err = await quiet(() => getReject(getDb.recover(mkWoItems(log), writeBackup(name, content), { bLog: false })))
            assert.ok(String(err).includes('invalid backup'), `${name}: ${err}`)
            assert.strict.deepEqual(log, [])
        }
    })

    it('B04 recover之備份含woItems沒有之資料表即於寫入前reject', async function() {
        //P4-2: 先驗全部再寫入, 不留部分還原
        let log = []
        let fp = writeBackup('unknown.json', JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }, { name: 'nope', data: [{ id: 'b' }] }]))
        let err = await quiet(() => getReject(getDb.recover(mkWoItems(log), fp, { bLog: false })))
        assert.ok(String(err).includes('nope'))
        assert.strict.deepEqual(log, [])
    })

    it('B05 recover成功', async function() {
        //D5: 成功路徑不變
        let log = []
        let fp = writeBackup('ok.json', JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]))
        await quiet(() => getDb.recover(mkWoItems(log), fp, { bLog: false }))
        assert.strict.deepEqual(log, [{ fn: 'insert', table: 'tests', d: [{ id: 'a' }] }])
    })

    it('B06 recover之bRela缺ds或genModelsByTabs即於寫入前reject', async function() {
        //P4-1: 明確訊息, 不寫入
        let log = []
        let fp = writeBackup('rela.json', JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]))
        let err = await quiet(() => getReject(getDb.recover(mkWoItems(log), fp, { bRela: true, bLog: false })))
        assert.ok(String(err).includes('genModelsByTabs'))
        assert.strict.deepEqual(log, [])
    })

    it('B07 recover之bRela帶ds與genModelsByTabs可產生model並建表寫入', async function() {
        //P4-1: genModelsByTabs收到各表settings, 之後建表並寫入
        let log = []
        let calls = []
        let ds = { tests: { keys: ['id'], settings: { id: { pk: true, type: 'STRING' } } } }
        let genModelsByTabs = (fdModels, tabs) => {
            calls.push({ fdModels, tabs })
        }
        let fp = writeBackup('rela2.json', JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]))
        await quiet(() => getDb.recover(mkWoItems(log), fp, { bRela: true, ds, genModelsByTabs, fdModels: './test/_tmp/unit-getDb/models', bLog: false }))
        assert.strict.equal(calls.length, 1)
        assert.strict.deepEqual(calls[0].tabs, { tests: ds.tests.settings })
        assert.strict.deepEqual(log.map((v) => v.fn), ['createStorage', 'insert'])
    })

    it('B08 低階recover之備份內容無效即reject', async function() {
        //P4-2: WServOrm實例上之recover即此低階函數
        let fp = writeBackup('bad2.json', '{bad')
        let err = await getReject(br.recover(fp, mkWoItems([])))
        assert.ok(String(err).includes('invalid backup'))
    })

    it('B12 backup之woItems無效即reject且為Error', async function() {
        //錯誤型別: 工具函數一律拋Error(原由pmSeries以字串reject); 空物件與空陣列原會產出recover拒收之空備份, 一併拒絕
        for (let bad of [null, undefined, 'x', 1, [], {}]) {
            let err = await quiet(() => getReject(br.backup(bad)))
            assert.ok(err instanceof Error && err.message === 'invalid woItems', `低階 ${String(bad)}: ${err}`)
            err = await quiet(() => getReject(getDb.backup(bad, { bLog: false })))
            assert.ok(err instanceof Error && err.message === 'invalid woItems', `getDb ${String(bad)}: ${err}`)
        }
    })

    it('B09 backup成功寫出備份檔(子行程)', async function() {
        //D5: 成功路徑不變
        let r = runChild('bk-ok', `import getDb from '${urlGetDb}'\nlet woItems = { tests: { select: async () => [{ id: 'a' }] } }\nawait getDb.backup(woItems, { bLog: false })\nconsole.log('RESOLVED')\n`)
        assert.strict.equal(r.status, 0, r.stderr)
        assert.ok(r.stdout.includes('RESOLVED'))
        assert.strict.equal(r.files.length, 1)
        let j = JSON.parse(fs.readFileSync(path.join(r.dir, r.files[0]), 'utf8'))
        assert.strict.deepEqual(j, [{ name: 'tests', data: [{ id: 'a' }] }])
    })

    it('B10 仿g_backupDb未await呼叫而失敗時離開碼非零(子行程)', async function() {
        //D5: 使用端之頂層呼叫未await, 失敗成為未處理之rejection
        let r = runChild('bk-fail', `import getDb from '${urlGetDb}'\nlet woItems = { tests: { select: async () => { throw new Error('E-select') } } }\ngetDb.backup(woItems)\n`)
        assert.notStrictEqual(r.status, 0)
        assert.strict.equal(r.files.length, 0)
    })

    it('B11 backup資料無法序列化即reject且不寫出空檔(子行程)', async function() {
        //D5: o2j失敗回空字串, 不得寫出空備份而回報成功
        let r = runChild('bk-circular', `import getDb from '${urlGetDb}'\nlet a = { id: 'a' }\na.self = a\nlet woItems = { tests: { select: async () => [a] } }\nlet out = 'RESOLVED'\nawait getDb.backup(woItems, { bLog: false }).catch(() => { out = 'REJECTED' })\nconsole.log(out)\n`)
        assert.ok(r.stdout.includes('REJECTED'), r.stdout + r.stderr)
        assert.strict.equal(r.files.length, 0)
    })

})
