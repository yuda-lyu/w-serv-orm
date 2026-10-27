import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import getDb from '../src/getDb.mjs'
import genTestData from '../src/genTestData.mjs'
import getSettings from '../src/getSettings.mjs'
import WServOrm from '../src/WServOrm.mjs'


//R-DIAG-01(orm-run01): 工具路徑(getDb 的 backup 與 recover、WServOrm 實例上的 recover、genTestData、getSettings)之診斷輸出同 procOrm:
//預設不含資料列、主鍵與ORM錯誤原文(getSettings 另不含資料庫帳號與密碼), opt.logDetail 為 true 還原完整輸出, opt.funLog 取代 console 並收完整細節; Error 的訊息與 reject 契約不變
let SECRET = 'u-secret@example.com'
let ERRTXT = 'E-raw-9f3a duplicate key'
let PASS = 'p4ss-W0rd-secret'
let fd = path.resolve('./test/_tmp/unit-diaglog-tools')

async function getReject(pm) {
    try {
        await pm
    }
    catch (err) {
        return err
    }
    throw new Error('預期reject但resolve')
}

async function capture(fn) {
    let calls = []
    let logOrig = console.log
    console.log = (...a) => {
        calls.push(a)
    }
    try {
        await fn()
    }
    finally {
        console.log = logOrig
    }
    return { calls, text: calls.map((a) => util.format(...a)).join('\n') }
}

//多表替身: results[表名]為該表insert之回傳函數(未給則回契約內之成功結果)
function mkWoItems(results = {}) {
    let woItems = {}
    for (let name of ['t1', 't2']) {
        woItems[name] = {
            select: async () => [{ id: SECRET }],
            insert: async (d) => (results[name] ? results[name](d) : { n: d.length, nInserted: d.length, ok: 1 }),
        }
    }
    return woItems
}

let BK = [{ name: 't1', data: [{ id: SECRET }] }, { name: 't2', data: [{ id: SECRET }] }]
let failAgg = { t2: (d) => ({ n: d.length, nInserted: 0, ok: 0, err: `${ERRTXT} ${SECRET}` }) }
let failArr = { t2: (d) => d.map(() => ({ n: 1, nInserted: 0, ok: 0, err: `${ERRTXT} ${SECRET}` })) }


describe('工具路徑之診斷輸出(R-DIAG-01)', function() {

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        fs.writeFileSync(path.join(fd, 'bk.json'), JSON.stringify(BK), 'utf8')
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })

    let fp = () => path.join(fd, 'bk.json')

    for (let [title, results, detail, safeFail] of [['聚合物件ok為0', failAgg, { n: 1, nInserted: 0, ok: 0, err: `${ERRTXT} ${SECRET}` }, { ok: 0 }], ['逐筆陣列ok為0', failArr, [{ n: 1, nInserted: 0, ok: 0, err: `${ERRTXT} ${SECRET}` }], { n: 1, ks: [0] }]]) {

        it(`T01 getDb.recover之insert回報${title}: 預設console不含主鍵與原文, reject之Error訊息不變`, async function() {
            //R-DIAG-01 規則1、4; R-DB-01 規則3: Error訊息(含ORM回傳原文)為回傳契約不變, 只動console輸出
            let err = null
            let cap = await capture(async () => {
                err = await getReject(getDb.recover(mkWoItems(results), fp(), { bLog: false }))
            })
            assert.ok(err instanceof Error && err.message.startsWith('failed to recover data into table[t2]: '), String(err))
            assert.ok(err.message.includes(SECRET) && err.message.includes(ERRTXT), 'Error訊息維持含ORM回傳原文(契約)')
            assert.ok(!cap.text.includes(SECRET), cap.text)
            assert.ok(!cap.text.includes(ERRTXT), cap.text)
            assert.strict.deepEqual(cap.calls.map((a) => a[0]), ['recover...', 'recover...', 't2.insert fail', 'recover catch'])
            assert.strict.deepEqual(cap.calls[3], ['recover catch', { errType: 'Error' }])
        })

        it(`T02 getDb.recover之insert回報${title}: logDetail為true還原完整輸出, funLog收完整細節且console無診斷輸出`, async function() {
            //R-DIAG-01 規則3
            let cap = await capture(async () => {
                await getReject(getDb.recover(mkWoItems(results), fp(), { bLog: false, logDetail: true }))
            })
            assert.strict.deepEqual(cap.calls.find((a) => a[0] === 't2.insert fail').slice(1), [detail])
            //還原舊輸出: 舊版為console.log(err), 即單一引數之Error(外審 terra F14)
            let eCall = cap.calls[cap.calls.length - 1]
            assert.strict.equal(eCall.length, 1)
            assert.ok(eCall[0] instanceof Error && eCall[0].message.startsWith('failed to recover data into table[t2]: '))
            let fun = []
            let cap2 = await capture(async () => {
                await getReject(getDb.recover(mkWoItems(results), fp(), { bLog: false, funLog: (...a) => fun.push(a) }))
            })
            assert.strict.deepEqual(cap2.calls, []) //進度訊息亦經funLog, console完全無輸出(外審 terra F03)
            assert.strict.deepEqual(fun.map((a) => a[0]), ['recover...', 'recover...', 't2.insert fail', 'recover catch'])
            assert.strict.deepEqual(fun[2].slice(2), [detail])
            assert.ok(fun[3][2] instanceof Error && fun[3][2].message.includes(ERRTXT))
        })

        it(`T03 WServOrm實例上之recover(低階, 參數不變)依實例之opt: ${title}`, async function() {
            //R-DIAG-01 規則3: 實例上之recover即低階函數, 診斷輸出依該實例之logDetail與funLog
            let WOrm = function() {
                return { select: async () => [], insert: async () => ({ n: 1, ok: 1 }) }
            }
            let ds = { t1: { keys: ['id'] }, t2: { keys: ['id'] } }
            let mk = (opt) => WServOrm(ds, WOrm, 'url', 'db', opt)
            let fun = []
            let so = mk({ funLog: (...a) => fun.push(a) })
            let soDef = mk()
            let soDet = mk({ logDetail: true })
            let capDef = await capture(async () => {
                let err = await getReject(soDef.recover(fp(), mkWoItems(results)))
                assert.ok(err instanceof Error && err.message.includes(SECRET)) //reject不變
            })
            assert.ok(!capDef.text.includes(SECRET) && !capDef.text.includes(ERRTXT), capDef.text)
            assert.strict.deepEqual(capDef.calls.find((a) => a[0] === 't2.insert fail'), ['t2.insert fail', safeFail])
            let capDet = await capture(async () => {
                await getReject(soDet.recover(fp(), mkWoItems(results)))
            })
            assert.strict.deepEqual(capDet.calls.find((a) => a[0] === 't2.insert fail').slice(1), [detail])
            let capFun = await capture(async () => {
                await getReject(so.recover(fp(), mkWoItems(results)))
            })
            assert.strict.deepEqual(capFun.calls, []) //進度訊息亦經funLog
            assert.strict.deepEqual(fun.map((a) => a[0]), ['recover...', 'recover...', 't2.insert fail'])
            assert.strict.deepEqual(fun[2].slice(1, 3), [safeFail, detail])
            //實例上之backup亦依本實例之設定(進度經funLog)
            let funB = []
            let soB = mk({ funLog: (...a) => funB.push(a) })
            let capB = await capture(async () => {
                await soB.backup(mkWoItems())
            })
            assert.strict.deepEqual(capB.calls, [])
            assert.strict.deepEqual(funB.map((a) => a.slice(0, 2)), [['backup...', 't1'], ['backup...', 't2']])
        })

    }

    it('T04 getDb.backup之select失敗: 預設console不含ORM原文, reject原錯誤不變; logDetail還原, funLog收細節', async function() {
        //R-DIAG-01: backup失敗時原console.log(err)含ORM錯誤原文
        let woItems = { t1: { select: async () => Promise.reject(new Error(`${ERRTXT} ${SECRET}`)) } }
        let err = null
        let cap = await capture(async () => {
            err = await getReject(getDb.backup(woItems, { bLog: false }))
        })
        assert.ok(err instanceof Error && err.message === `${ERRTXT} ${SECRET}`)
        assert.ok(!cap.text.includes(SECRET) && !cap.text.includes(ERRTXT), cap.text)
        assert.strict.deepEqual(cap.calls.find((a) => a[0] === 'backup catch'), ['backup catch', { errType: 'Error' }])
        let capDet = await capture(async () => {
            await getReject(getDb.backup(woItems, { bLog: false, logDetail: true }))
        })
        assert.strict.equal(capDet.calls[capDet.calls.length - 1].length, 1) //舊版為console.log(err), 單一引數(外審 terra F14)
        assert.ok(capDet.calls[capDet.calls.length - 1][0] instanceof Error)
        let fun = []
        await capture(async () => {
            await getReject(getDb.backup(woItems, { bLog: false, funLog: (...a) => fun.push(a) }))
        })
        assert.strict.deepEqual(fun.map((a) => a[0]), ['backup...', 'backup catch'])
        assert.ok(fun[1][2] instanceof Error)
    })

    it('T05 getDb之診斷選項型別錯誤者忽略並用預設(同bLog)', async function() {
        //R-DIAG-01 規則3: 工具路徑的選項慣例為忽略型別錯誤者(與 bLog 一致), 用預設之安全輸出
        let woItems = { t1: { select: async () => Promise.reject(new Error(`${ERRTXT} ${SECRET}`)) } }
        let cap = await capture(async () => {
            await getReject(getDb.backup(woItems, { bLog: false, logDetail: 'true', funLog: 'x' }))
        })
        assert.ok(!cap.text.includes(SECRET) && !cap.text.includes(ERRTXT), cap.text)
        assert.ok(cap.calls.some((a) => a[0] === 'backup catch'))
    })

    it('T06 genTestData之bLog輸出: 預設只列筆數而不列資料列, logDetail還原, funLog收完整列, bLog為false不輸出', async function() {
        //R-DIAG-01: 原 console.log 於預設(bLog 預設 true)印出整批資料列(含主鍵)
        let rows = [{ id: SECRET, name: 'a' }, { id: 'x2', name: 'b' }]
        let dsT = { t1: { funTest: async () => rows, funTestAndSave: async () => rows } }
        let woItems = { t1: { save: async (d) => d.map(() => ({ n: 1, ok: 1 })) } }
        for (let mode of ['funTest', 'funTestAndSave']) {
            let label = mode === 'funTest' ? 't1.funTest and save' : 't1.funTestAndSave'
            let cap = await capture(async () => {
                await genTestData(dsT, woItems, { mode })
            })
            assert.strict.deepEqual(cap.calls, [[label, { n: 2 }]], mode)
            let capDet = await capture(async () => {
                await genTestData(dsT, woItems, { mode, logDetail: true })
            })
            assert.strict.deepEqual(capDet.calls, [[label, rows]], mode)
            let fun = []
            let capFun = await capture(async () => {
                await genTestData(dsT, woItems, { mode, funLog: (...a) => fun.push(a) })
            })
            assert.strict.deepEqual(capFun.calls, [])
            assert.strict.deepEqual(fun, [[label, { n: 2 }, rows]], mode)
            let capOff = await capture(async () => {
                await genTestData(dsT, woItems, { mode, bLog: false })
            })
            assert.strict.deepEqual(capOff.calls, [], mode)
        }
    })

    it('T07 genTestData寫入失敗之Error訊息不變(含ORM回傳原文, 契約)', async function() {
        //R-DIAG-01 規則4: 只動console輸出; 拋出之Error訊息(R-ORM-RESULT-01)不變
        let dsT = { t1: { funTest: async () => [{ id: SECRET }] } }
        let woItems = { t1: { save: async () => [{ n: 1, ok: 0, err: ERRTXT }] } }
        let err = await getReject(genTestData(dsT, woItems, { mode: 'funTest', bLog: false }))
        assert.strict.equal(err.message, `failed to write test data into table[t1]: ${JSON.stringify([{ k: 0, id: SECRET, err: ERRTXT }])}`)
    })

    it('T08 getSettings之設定檔無效: 預設不傾印設定值(含資料庫帳號與密碼), 只列鍵名; logDetail還原傾印; 拋出之Error不變', async function() {
        //R-DIAG-01: 原 console.log('st', st) 於缺欄位時印出整份設定(含 dbPassword)
        let fn = path.join(fd, 'settings-bad.json')
        fs.writeFileSync(fn, JSON.stringify({ dbType: 'mongodb', dbUsername: 'admin', dbPassword: PASS, dbIP: 'localhost', dbPort: 27017 }), 'utf8') //缺 dbName
        let err = null
        let cap = await capture(async () => {
            try {
                getSettings({ fn })
            }
            catch (e) {
                err = e
            }
        })
        assert.ok(err instanceof Error && err.message === 'failed to read settings file')
        assert.ok(!cap.text.includes(PASS) && !cap.text.includes('admin'), cap.text)
        assert.strict.deepEqual(cap.calls, [['st', { keys: ['dbType', 'dbUsername', 'dbPassword', 'dbIP', 'dbPort'], nOther: 0 }], ['getSettings catch', { errType: 'Error' }]])
        let capDet = await capture(async () => {
            try {
                getSettings({ fn, logDetail: true })
            }
            catch (e) {
                err = e
            }
        })
        assert.strict.deepEqual(capDet.calls[0][1].dbPassword, PASS)
        assert.strict.equal(capDet.calls[1].length, 1) //舊版為console.log(err)
        assert.ok(capDet.calls[1][0] instanceof Error)
    })

    it('T08b getSettings之摘要只列已知鍵: 設定檔之未知鍵(部署者自撰, 可能為識別)只計數不列出', async function() {
        //R-DIAG-01(外審 terra F05)
        let fn = path.join(fd, 'settings-unknown-key.json')
        fs.writeFileSync(fn, JSON.stringify(Object.fromEntries([['dbType', 'mongodb'], [SECRET, 'x'], ['k-2', 'y']])), 'utf8')
        let cap = await capture(async () => {
            try {
                getSettings({ fn })
            }
            catch (e) {
                //預期拋 failed to read settings file
            }
        })
        assert.ok(!cap.text.includes(SECRET), cap.text)
        assert.strict.deepEqual(cap.calls[0], ['st', { keys: ['dbType'], nOther: 2 }])
    })

    it('T08c getSettings之設定檔不存在或無法解析: 錯誤(含檔案路徑)不直接輸出, 預設只列類別; funLog取代console; 拋出之Error不變', async function() {
        //R-DIAG-01(外審 terra F02): ENOENT之Error含完整路徑(此處含使用者識別)
        let fnMissing = path.join(fd, `missing-${SECRET}.json`)
        let fnBad = path.join(fd, 'settings-broken.json')
        fs.writeFileSync(fnBad, '{ dbType: ', 'utf8')
        for (let fn of [fnMissing, fnBad]) {
            let err = null
            let cap = await capture(async () => {
                try {
                    getSettings({ fn })
                }
                catch (e) {
                    err = e
                }
            })
            assert.ok(err instanceof Error && err.message === 'failed to read settings file')
            assert.ok(!cap.text.includes(SECRET), cap.text)
            assert.strict.deepEqual(cap.calls.map((a) => a[0]), ['getSettings catch'])
            let fun = []
            let cap2 = await capture(async () => {
                try {
                    getSettings({ fn, funLog: (...a) => fun.push(a) })
                }
                catch (e) {
                    //預期拋
                }
            })
            assert.strict.deepEqual(cap2.calls, [])
            assert.strict.deepEqual(fun.map((a) => a[0]), ['getSettings catch'])
            assert.ok(fun[0][2] instanceof Error)
        }
    })

    it('T10 recover之紀錄函式原地改動收到的ORM回傳: Error訊息不變', async function() {
        //R-DIAG-01 規則4(外審 terra F08): 訊息先於診斷輸出組出
        let expected = null
        await capture(async () => {
            expected = (await getReject(getDb.recover(mkWoItems(failArr), fp(), { bLog: false }))).message
        })
        let funLog = (label, safe, detail) => {
            if (Array.isArray(detail)) {
                detail.forEach((v) => {
                    v.err = '***'
                    v.ok = -1
                })
                detail.length = 0
            }
        }
        let got = null
        await capture(async () => {
            got = (await getReject(getDb.recover(mkWoItems(failArr), fp(), { bLog: false, funLog }))).message
        })
        assert.strict.equal(got, expected)
        assert.ok(got.includes(ERRTXT))
    })

    it('T11 無效參數(ds、WOrm、url、db、woItems、fp): 預設只輸出型別, 不輸出呼叫端傳入之值; funLog取代console; logDetail還原舊輸出; 拋出之Error不變', async function() {
        //R-DIAG-01(外審 terra F01): 傳入之無效值可含連線字串帳密、識別等
        let urlObj = { host: 'h', password: PASS }
        let WOrmOk = function() {
            return {}
        }
        let cases = [
            ['ds', () => WServOrm(SECRET, WOrmOk, 'u', 'd'), 'invalid ds', { type: 'string' }, SECRET],
            ['WOrm', () => WServOrm({ t: {} }, SECRET, 'u', 'd'), 'invalid WOrm', { type: 'string' }, SECRET],
            ['url', () => WServOrm({ t: {} }, WOrmOk, urlObj, 'd'), 'invalid url', { type: 'object' }, urlObj],
            ['db', () => WServOrm({ t: {} }, WOrmOk, 'u', { name: SECRET }), 'invalid db', { type: 'object' }, SECRET],
            ['woItems', () => getDb.backup(SECRET, { bLog: false }), 'invalid woItems', { type: 'string' }, SECRET],
            ['woItems', () => getDb.recover(SECRET, fp(), { bLog: false }), 'invalid woItems', { type: 'string' }, SECRET],
            ['fp', () => getDb.recover(mkWoItems(), path.join(fd, `nofile-${SECRET}.json`), { bLog: false }), 'fp is not exist', { type: 'string' }, path.join(fd, `nofile-${SECRET}.json`)],
        ]
        for (let [label, run, msg, safe] of cases) {
            let err = null
            let cap = await capture(async () => {
                err = await Promise.resolve().then(run).then(() => null, (e) => e)
            })
            assert.ok(err instanceof Error && err.message === msg, `${label}: ${err}`)
            assert.ok(!cap.text.includes(SECRET) && !cap.text.includes(PASS), `${label}: ${cap.text}`)
            assert.strict.deepEqual(cap.calls.find((a) => a[0] === label), [label, safe], label)
        }
        //logDetail還原舊輸出(標籤接原值)
        let capDet = await capture(async () => {
            await Promise.resolve().then(() => WServOrm({ t: {} }, WOrmOk, urlObj, 'd', { logDetail: true })).catch(() => {})
        })
        assert.strict.deepEqual(capDet.calls, [['url', urlObj]])
        //funLog: console無輸出, 收型別摘要與原值
        let fun = []
        let capFun = await capture(async () => {
            await Promise.resolve().then(() => WServOrm({ t: {} }, WOrmOk, urlObj, 'd', { funLog: (...a) => fun.push(a) })).catch(() => {})
        })
        assert.strict.deepEqual(capFun.calls, [])
        assert.strict.deepEqual(fun, [['url', { type: 'object' }, urlObj]])
    })

    it('T12 genTestData之bLog摘要不讀取回傳物件之屬性: 非真陣列者筆數為null, 不因length之getter而拋錯或印出', async function() {
        //R-DIAG-01(外審 terra F11)
        let weird = {
            get length() {
                throw new Error('length getter')
            },
        }
        //實得值先轉純資料再比對: 若摘要誤含該物件, 斷言失敗時格式化差異不得因其getter而拋錯(使測試行程靜默結束)
        let plain = (v) => {
            try {
                return JSON.parse(JSON.stringify(v))
            }
            catch (e) {
                return '(unserializable)'
            }
        }
        let dsT = { t1: { funTestAndSave: async () => weird } }
        let cap = await capture(async () => {
            await genTestData(dsT, {}, { mode: 'funTestAndSave' })
        })
        assert.strict.deepEqual(plain(cap.calls), [['t1.funTestAndSave', { n: null }]])
        let weird2 = { length: 987654321 }
        let cap2 = await capture(async () => {
            await genTestData({ t1: { funTestAndSave: async () => weird2 } }, {}, { mode: 'funTestAndSave' })
        })
        assert.strict.deepEqual(plain(cap2.calls), [['t1.funTestAndSave', { n: null }]])
    })

    it('T13 getDb.recover(bRela)之schema傾印與進度: 預設只列表名, logDetail還原完整schema, funLog時console完全無輸出', async function() {
        //R-DIAG-01(外審 terra F03): schema之settings可含預設值等, 完整傾印為細節; 完成訊息亦經funLog
        let ds = { tests: { keys: ['id'], settings: { id: { pk: true, type: 'STRING', defaultValue: SECRET } } } }
        let woItemsR = { tests: { select: async () => [], insert: async (d) => ({ n: d.length, ok: 1 }), createStorage: async () => 'created' } }
        let fpR = path.join(fd, 'bk-rela.json')
        fs.writeFileSync(fpR, JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
        let optR = { bRela: true, ds, genModelsByTabs: () => {}, fdModels: './test/_tmp/unit-diaglog-tools/models' }
        let cap = await capture(async () => {
            await getDb.recover(woItemsR, fpR, optR)
        })
        assert.ok(!cap.text.includes(SECRET), cap.text)
        assert.strict.deepEqual(cap.calls, [['tabs', { n: 1, tables: ['tests'] }], ['recover...', 'tests'], ['needCreateStorage'], ['recover finish']])
        let capDet = await capture(async () => {
            await getDb.recover(woItemsR, fpR, { ...optR, logDetail: true })
        })
        assert.strict.deepEqual(capDet.calls[0], ['tabs', { tests: ds.tests.settings }])
        let fun = []
        let capFun = await capture(async () => {
            await getDb.recover(woItemsR, fpR, { ...optR, funLog: (...a) => fun.push(a) })
        })
        assert.strict.deepEqual(capFun.calls, [])
        assert.strict.deepEqual(fun.map((a) => a[0]), ['tabs', 'recover...', 'needCreateStorage', 'recover finish'])
        assert.strict.deepEqual(fun[0].slice(1), [{ n: 1, tables: ['tests'] }, { tests: ds.tests.settings }])
        //logDetail還原舊版完整序列(外審 terra R2-07: 進度亦帶原引數)
        assert.strict.deepEqual(capDet.calls, [['tabs', { tests: ds.tests.settings }], ['recover...', 'tests'], ['needCreateStorage'], ['recover finish']])
    })

    it('T14 紀錄函式原地改動交給它的Error(message、stack、自訂欄位): 拋給呼叫端之原錯誤不變(backup、recover、缺bRela設定)', async function() {
        //R-DIAG-01 規則4(外審 terra R2-03): 細節為拷貝
        let mask = (label, safe, detail) => {
            if (detail instanceof Error) {
                detail.message = 'masked'
                detail.stack = 'masked'
                detail.code = 'MASKED'
                detail.extra = 1
            }
        }
        let errOrig = new Error(`${ERRTXT} ${SECRET}`)
        errOrig.code = 'ORIG'
        let woBackup = { t1: { select: async () => Promise.reject(errOrig) } }
        let got = await getReject(getDb.backup(woBackup, { bLog: false, funLog: mask }))
        assert.ok(got === errOrig, '拋出之仍是原物件')
        assert.strict.equal(got.message, `${ERRTXT} ${SECRET}`)
        assert.strict.equal(got.code, 'ORIG')
        assert.ok(!('extra' in got))
        let got2 = await getReject(getDb.recover(mkWoItems(failAgg), fp(), { bLog: false, funLog: mask }))
        assert.ok(got2.message.startsWith('failed to recover data into table[t2]: '))
        assert.ok(got2.message.includes(SECRET) && !('extra' in got2) && got2.code === undefined)
        let got3 = await getReject(getDb.recover(mkWoItems(), fp(), { bLog: false, bRela: true, funLog: mask }))
        assert.strict.equal(got3.message, 'bRela needs opt.ds and opt.genModelsByTabs')
        assert.ok(!('extra' in got3))
    })

    it('T15 紀錄函式原地改動schema細節(刪表、改巢狀設定): 傳給模型產生器之tabs與原ds不變', async function() {
        //R-DIAG-01 規則4(外審 terra R2-04)
        let ds = { tests: { keys: ['id'], settings: { id: { pk: true, type: 'STRING' } } } }
        let woItemsR = { tests: { select: async () => [], insert: async (d) => ({ n: d.length, ok: 1 }), createStorage: async () => 'created' } }
        let fpR = path.join(fd, 'bk-rela2.json')
        fs.writeFileSync(fpR, JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
        let seen = null
        let genModelsByTabs = (fdModels, tabs) => {
            seen = JSON.parse(JSON.stringify(tabs))
        }
        let funLog = (label, safe, detail) => {
            if (label === 'tabs') {
                detail.tests.id.type = 'INTEGER'
                delete detail.tests.id.pk
                detail.extra = {}
                delete detail.tests
            }
        }
        await capture(async () => {
            await getDb.recover(woItemsR, fpR, { bRela: true, ds, genModelsByTabs, fdModels: './test/_tmp/unit-diaglog-tools/models', funLog })
        })
        assert.strict.deepEqual(seen, { tests: { id: { pk: true, type: 'STRING' } } })
        assert.strict.deepEqual(ds.tests.settings, { id: { pk: true, type: 'STRING' } })
    })

    it('T16 getDb.recover(bRela)之選項只讀一次: funLog之getter前後不同者, schema傾印與進度仍走同一紀錄函式; 單一getter拋錯不連累另一選項', async function() {
        //R-DIAG-01(外審 terra R2-06)
        let ds = { tests: { keys: ['id'], settings: { id: { pk: true, type: 'STRING' } } } }
        let woItemsR = { tests: { select: async () => [], insert: async (d) => ({ n: d.length, ok: 1 }), createStorage: async () => 'created' } }
        let fpR = path.join(fd, 'bk-rela3.json')
        fs.writeFileSync(fpR, JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
        let n = 0
        let got = []
        let logger = (...a) => got.push(a[0])
        let optR = {
            bRela: true,
            ds,
            genModelsByTabs: () => {},
            fdModels: './test/_tmp/unit-diaglog-tools/models',
            get funLog() {
                n++
                return n === 1 ? logger : null
            },
        }
        let cap = await capture(async () => {
            await getDb.recover(woItemsR, fpR, optR)
        })
        assert.strict.deepEqual(cap.calls, [])
        assert.strict.deepEqual(got, ['tabs', 'recover...', 'needCreateStorage', 'recover finish'])
        assert.strict.equal(n, 1)
        //單一getter拋錯
        let got2 = []
        let optB = {
            bLog: false,
            funLog: (...a) => got2.push(a[0]),
            get logDetail() {
                throw new Error('boom')
            },
        }
        let cap2 = await capture(async () => {
            await getReject(getDb.backup(SECRET, optB))
        })
        assert.strict.deepEqual(cap2.calls, [])
        assert.strict.deepEqual(got2, ['woItems', 'backup catch'])
    })

    it('T18 recover之訊息組成拋出null或undefined或字串: 先輸出診斷, 再原樣拋出該值(同舊版), 不轉為Error', async function() {
        //R-DIAG-01(外審 terra R3-05): 以旗標而非哨兵值判斷是否拋出; 此案在HEAD之src同樣通過(舊版行為)
        for (let thrown of [null, undefined, 'str-thrown']) {
            let r = {
                n: 1,
                ok: 0,
                toJSON() {
                    throw thrown
                },
            }
            let fun = []
            let got = 'unset'
            await capture(async () => {
                try {
                    await getDb.recover(mkWoItems({ t2: () => r }), fp(), { bLog: false, funLog: (...a) => fun.push(a[0]) })
                }
                catch (e) {
                    got = e
                }
            })
            assert.strict.equal(got, thrown, String(thrown))
        }
    })

    it('T17 recover之insert結果無法序列化(循環): 先輸出診斷再拋出同一TypeError(同舊版次序)', async function() {
        //R-DIAG-01(外審 terra R2-08)
        let circ = { n: 1, nInserted: 0, ok: 0 }
        circ.self = circ
        let woItems = mkWoItems({ t2: () => circ })
        let fun = []
        let err = await getReject(getDb.recover(woItems, fp(), { bLog: false, funLog: (...a) => fun.push(a[0]) }))
        assert.ok(err instanceof TypeError, String(err))
        assert.ok(fun.includes('t2.insert fail'), fun.join(','))
        assert.strict.equal(fun[fun.length - 1], 'recover catch')
    })

    it('T09 getSettings之設定檔有效: 回傳不變且無診斷輸出', async function() {
        //R-DIAG-01 規則4
        let fn = path.join(fd, 'settings-ok.json')
        fs.writeFileSync(fn, JSON.stringify({ dbType: 'mongodb', dbUsername: 'admin', dbPassword: PASS, dbIP: 'localhost', dbPort: 27017, dbName: 'w' }), 'utf8')
        let st = null
        let cap = await capture(async () => {
            st = getSettings({ fn })
        })
        assert.strict.deepEqual(cap.calls, [])
        assert.strict.equal(st.url, `mongodb://admin:${PASS}@localhost:27017`)
        assert.strict.equal(st.db, 'w')
    })

})
