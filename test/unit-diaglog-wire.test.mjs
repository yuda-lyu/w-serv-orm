import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import diagCases from 'wsemi/src/_diagCases.mjs'
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
import WServOrm from '../src/WServOrm.mjs'
import getDb from '../src/getDb.mjs'
import { SAFE_KEYS } from '../src/safeKeys.mjs'
import genTestData from '../src/genTestData.mjs'
import { addHook } from './tools/hookKit.mjs'


//R-DIAG-01 之接線測試(2026-10-29 mig-servorm; 規格 C:\opensrcOper\dspec\診斷輸出與遮罩.md, 實作 wsemi 之 getDiag 系列, wsemi 帳本 R-DIAG-01):
//  A. 共用語料(wsemi/src/_diagCases.mjs)之wire案, 依本套件適用之子集, 經本套件之真實呼叫點執行(形態類案由wsemi自測, 本套件不重複)
//  B. 外來值(ORM、檔案系統、使用端回呼拋出或reject之值)之對外錯誤: 含本實例連線憑證者經diag.err移除(副本、同類別), 無應處理者身分不變
//  C. 套件自身以固定詞彙組成之reject與throw: 原樣(不經遮罩; 密碼為固定詞彙之子字串時亦不被挖空)
//  D. 逐筆結果之err(工具路徑之Error訊息與診斷細節): 含憑證者遮罩, 固定詞彙與表名原樣
//  E. 診斷輸出之串流: 全部站點寫console.log(stdout), 不寫console.error
//  F. 站點全集之靜態盤點(對外錯誤值之diag.err、diag.mask站點)
//秘密: 本套件之秘密為連線位址(WServOrm之url; getSettings之設定檔帳密), 以語料之secrets().url扮演


let fd = path.resolve('./test/_tmp/unit-diaglog-wire')
let DS = { tests: { keys: ['id', 'name'] } }


//語料wire案之處置表(每個wire案必有一列, 新增之wire案未列入者由第一個測試判紅):
//  D=ORM以該值reject, 由procOrm之catch站點交funLog之detail驗證; S=摘要(safe); L=logDetail之console輸出; R=擴充函數以該值reject, 驗procOrm之reject;
//  R+D=R與D兩者; R-fixed=以語料之密碼為連線憑證, 驗固定詞彙reject原樣; A=伺服端轉接器(genDiagFunLog)之funLog交本套件; static=靜態盤點; own=以本套件之形狀改寫(附理由)
let WIRE = {
    T01: 'D',
    T07: 'D',
    K01: 'D',
    K09: 'D',
    V02: 'D',
    E01: 'D',
    E07: 'D',
    P01: 'D',
    S07: 'D',
    C01: 'S',
    O01: 'L',
    O15: 'static',
    R01: 'R',
    R02: 'own 語料之秘密來源為兩個連線網址(畸形網址與完整網址), 本套件每實例只有一個url; 以畸形網址為本實例之url改寫(B組R02型): 副本、同類別、code保留、片段遮罩、短帳號不遮',
    R04: 'R',
    R07: 'R-fixed',
    R11: 'R+D',
    R12: 'R+D',
    A01: 'A',
    A07: 'A',
    A11: 'own 語料驗genDiagFunLog之opt.safeKeys; 本套件之下游以公開之SAFE_KEYS(src/safeKeys.mjs)為其值, 以語料之safe樣本(含憑證鍵名)驗名單外之鍵被丟棄、本套件之鍵原樣轉寫; 與實際產出一致見unit-diagsafe',
    C14: 'own 語料驗getDiagBriefErr之types(宣告時列驅動類別名); 本套件可搭配任一w-orm-*而不宣告驅動之類別名, 以語料之pg DatabaseError(實例name為error)經procOrm之catch站點驗未宣告為Error、集合外之實例name不列',
    U22: 'own 語料驗getDiagSecrets之conns分類; 本套件每實例一個url(連線字串或儲存路徑), 以語料之secrets().url與secrets().path各建一實例, 驗診斷細節與對外錯誤值之遮罩分類(取代原getUrlSecrets)',
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

function getThrow(fn) {
    try {
        fn()
    }
    catch (err) {
        return err
    }
    throw new Error('預期拋錯但未拋')
}

async function capture(fn) {
    //收集console.log與console.error(以util.format格式化之文字供檢查洩漏)
    let logs = []
    let errs = []
    let ol = console.log
    let oe = console.error
    console.log = (...a) => logs.push(a)
    console.error = (...a) => errs.push(a)
    try {
        await fn()
    }
    finally {
        console.log = ol
        console.error = oe
    }
    let text = [...logs, ...errs].map((a) => util.format(...a)).join('\n')
    return { logs, errs, text }
}

function mkWOrm(plan = {}) {
    //plan[fn]: 回傳(或reject)的函數; plan.close: close之行為; plan.ctor: 建構時之行為(可拋錯)
    return function(useOpt) {
        if (plan.ctor) {
            plan.ctor(useOpt)
        }
        let ev = {}
        for (let fn of ['select', 'insert', 'save', 'del', 'delAll', 'createStorage', 'close']) {
            ev[fn] = async (data) => {
                if (plan[fn]) {
                    return plan[fn](data)
                }
                if (fn === 'select') {
                    return []
                }
                if (fn === 'save' || fn === 'del') {
                    return (Array.isArray(data) ? data : [data]).map(() => ({ n: 1, ok: 1 }))
                }
                return { n: 1, ok: 1 }
            }
        }
        return ev
    }
}

let mkCtx = () => {
    return diagCases.mkCtx({ util: typeof process.getBuiltinModule === 'function' && process.getBuiltinModule('util') !== undefined })
}
let getCase = (id) => {
    let c = diagCases.cases.find((v) => v.id === id)
    assert.ok(c !== undefined, `語料無案[${id}]`)
    return c
}

//orm之catch站點(procOrm save, ORM以v reject): 回傳{ reject, fun }
async function viaOrmCatch(url, v, opt = {}) {
    let fun = []
    let so = WServOrm(DS, mkWOrm({ save: () => Promise.reject(v) }), url, 'db', { funLog: (...a) => fun.push(a), ...opt })
    let reject = await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a', name: 'x' }]))
    return { reject, fun }
}

//擴充函數(check)以v reject: 回傳procOrm之reject
async function viaHook(url, v, name = 'addFunCheck') {
    let so = WServOrm(DS, mkWOrm(), url, 'db')
    await addHook(so, name, () => Promise.reject(v))
    return getReject(so.procOrm('u1', 'tests', 'select', {}))
}

let srcOf = (file) => {
    //原始碼去除整行註解與行尾註解(字串內之//不處理, 本套件之src無此情形)
    return fs.readFileSync(path.resolve('./src', file), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n')
}
let count = (s, re) => (s.match(re) || []).length


describe('diaglog-wire(R-DIAG-01接線)', function() {

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })


    describe('A. 共用語料wire案之接線', function() {

        it('[靜態] 語料之wire案(20案)皆已於處置表登錄, 不得有未處置者', function() {
            //dspec D5: 各套件之接線測試以同一語料跑其宣告之路徑; 新增之wire案須先登錄處置
            let ids = diagCases.cases.filter((c) => c.wire).map((c) => c.id).sort()
            assert.deepStrictEqual(ids, Object.keys(WIRE).sort())
            assert.strictEqual(ids.length, 23)
            let kinds = {}
            Object.values(WIRE).forEach((v) => {
                kinds[v.split(' ')[0]] = (kinds[v.split(' ')[0]] || 0) + 1
            })
            assert.deepStrictEqual(kinds, { 'D': 9, 'S': 1, 'L': 1, 'static': 1, 'R': 2, 'own': 4, 'R-fixed': 1, 'R+D': 2, 'A': 2 })
        })

        for (let id of Object.keys(WIRE).filter((k) => WIRE[k] === 'D')) {
            let c = getCase(id)
            it(`${id} ${c.label}: ORM以該值reject, procOrm之catch站點交funLog之detail符合語料期望`, async function() {
                //dspec §6.4: 細節必經maskDiagCopy(本實例之detail清單); procOrm之reject為固定詞彙(R-ERR-01)
                let ctx = mkCtx()
                let v = c.make(ctx)
                let { reject, fun } = await viaOrmCatch(ctx.sec.url, v)
                assert.strictEqual(reject, 'failed to save data')
                assert.strictEqual(fun.length, 1)
                assert.strictEqual(fun[0][0], 'tests.save catch')
                assert.strictEqual(fun[0].length, 3)
                let r = diagCases.verify(c, fun[0][2], ctx)
                assert.strictEqual(r, null, String(r))
            })
        }

        it('C01 摘要代碼: ORM錯誤之code依wsemi之集合(ECONNREFUSED、EAI_AGAIN、E2BIG收), 經procOrm之catch站點之safe', async function() {
            //dspec §3.3: errCode只收SYS ∪ NODE ∪ 宣告之集合
            let c = getCase('C01')
            let ctx = mkCtx()
            let out = []
            for (let e of c.make(ctx)) {
                let { fun } = await viaOrmCatch(ctx.sec.url, e)
                out.push(fun[0][1])
            }
            assert.strictEqual(diagCases.verify(c, out, ctx), null)
        })

        it('C01b 本套件宣告之代碼集合(sqlstate、sqlite、mysql、mssql、mongoServer、lmdb、level)與巢狀鍵(original、parent)經procOrm之safe; 未宣告者與使用端類別名不列', async function() {
            //dspec §3.3、§6.6: 代碼只收明列者(不用樣式), 類別名只列內建或宣告者; 本套件可搭配任一w-orm-*故宣告全部具名集合(getDiagBrief.mjs)
            class MongoServerError extends Error {}
            let mk = (code, C = Error) => Object.assign(new C('x'), { code })
            let cases = [
                [mk(11000, MongoServerError), { errType: 'Error', errCode: 11000 }],
                [mk('23505'), { errType: 'Error', errCode: '23505' }],
                [mk('SQLITE_BUSY'), { errType: 'Error', errCode: 'SQLITE_BUSY' }],
                [mk('ER_DUP_ENTRY'), { errType: 'Error', errCode: 'ER_DUP_ENTRY' }],
                [mk('ELOGIN'), { errType: 'Error', errCode: 'ELOGIN' }],
                [mk('MDB_NOTFOUND'), { errType: 'Error', errCode: 'MDB_NOTFOUND' }],
                [mk('LEVEL_DATABASE_NOT_OPEN'), { errType: 'Error', errCode: 'LEVEL_DATABASE_NOT_OPEN' }],
                [Object.assign(new TypeError('x'), { original: { code: '23505' } }), { errType: 'TypeError', errCode: '23505' }],
                [Object.assign(new Error('x'), { parent: { code: 'SQLITE_BUSY' } }), { errType: 'Error', errCode: 'SQLITE_BUSY' }],
                [mk('ALICE123'), { errType: 'Error' }],
                [mk(987654321), { errType: 'Error' }],
                ['str', { errType: 'string' }],
            ]
            for (let [e, exp] of cases) {
                let { fun } = await viaOrmCatch('url', e)
                assert.deepStrictEqual(fun[0][1], exp, util.inspect(e))
            }
        })

        it('O01 logDetail: console.log(標籤, 細節拷貝)且細節遮罩', async function() {
            //dspec §3.2.1第4點: logDetail且有細節 → console[level](label, detail); bare已刪除
            let ctx = mkCtx()
            let { detail } = getCase('O01').make(ctx)
            let so = WServOrm(DS, mkWOrm({ save: () => Promise.reject(detail) }), ctx.sec.url, 'db', { logDetail: true })
            let cap = await capture(() => getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a' }])))
            assert.deepStrictEqual(cap.errs, [])
            assert.strictEqual(cap.logs.length, 1)
            assert.strictEqual(cap.logs[0][0], 'tests.save catch')
            assert.ok(cap.logs[0][1] instanceof Error && cap.logs[0].length === 2 && cap.logs[0][1] !== detail)
            assert.strictEqual(diagCases.verify({ expect: { noSecret: 'detail' } }, [{ m: 'log', args: cap.logs[0] }], ctx), null)
            assert.strictEqual(cap.logs[0][1].message, 'auth ***')
        })

        it('[靜態] O15 safe白名單: 本套件之getDiag只在getDiagBrief.mjs建立一次並宣告safeKeys(單一來源為公開之safeKeys.mjs), 白名單不含憑證鍵名', function() {
            //dspec §6.7第4點: 宣告safeKeys, 白名單外之鍵丟棄; 憑證鍵名之單一出處為wsemi之CRED_KEY_SRC; 名單內容與實際產出之鍵一致由unit-diagsafe以實際產出比對
            let code = srcOf('getDiagBrief.mjs')
            assert.strictEqual(count(code, /getDiag\(opt, \{ secrets, codes: CODES, nested: NESTED, safeKeys: SAFE_KEYS \}\)/g), 1)
            assert.ok(SAFE_KEYS.length > 0)
            SAFE_KEYS.forEach((k) => {
                assert.ok(!/password|passwd|pwd|secret|token|authorization|api[_-]?key|x-api-key|__sysToken__/i.test(k), k)
            })
            for (let f of fs.readdirSync(path.resolve('./src')).filter((v) => v.endsWith('.mjs') && v !== 'getDiagBrief.mjs')) {
                assert.strictEqual(count(srcOf(f), /safeKeys|wsemi\/src\/getDiag\.mjs/g), 0, f)
            }
        })

        it('O15 safe白名單之動態: 經真實站點之safe只含白名單之鍵(errType、errCode恆含)', async function() {
            //dspec §6.7第4點: 本套件之safe皆以白名單之鍵組成(預設輸出即safe)
            let ctx = mkCtx()
            let { fun } = await viaOrmCatch(ctx.sec.url, Object.assign(new Error('x'), { code: 'ENOENT' }))
            assert.deepStrictEqual(fun[0][1], { errType: 'Error', errCode: 'ENOENT' })
        })

        it('R01 不含憑證之外來錯誤: 擴充函數reject之值經procOrm轉出為同一物件(身分不變)', async function() {
            //dspec §6.5第4點: 無應處理者回原物件
            let c = getCase('R01')
            let ctx = mkCtx()
            let e = c.make(ctx)
            let err = await viaHook(ctx.sec.url, e)
            assert.strictEqual(diagCases.verify(c, [e, err], ctx), null)
        })

        it('R04 字串reject: 擴充函數以含密碼之字串reject, procOrm轉出遮罩後之字串', async function() {
            //dspec §6.5: 字串 → maskDiagText(reject清單)
            let c = getCase('R04')
            let ctx = mkCtx()
            let err = await viaHook(ctx.sec.url, c.make(ctx))
            assert.strictEqual(diagCases.verify(c, err, ctx), null)
        })

        it('R07 固定詞彙之reject原樣: 連線密碼為固定詞彙之子字串(語料之insert)時, procOrm之固定reject逐字原樣', async function() {
            //dspec §6.5第1點: 套件自身以固定詞彙組成之reject不經遮罩(挖空即反推短密碼)
            let { fixed, src } = getCase('R07').make(mkCtx())
            let url = `postgres://dbuser:${src.password}@db.example.com:5432/app`
            let so1 = WServOrm(DS, mkWOrm({ insert: () => Promise.reject(new Error(`dup ${url}`)) }), url, 'db')
            let so2 = WServOrm(DS, mkWOrm({ insert: () => ({ n: 1, ok: 0 }) }), url, 'db')
            let cap = await capture(async () => {
                assert.strictEqual(await getReject(so1.procOrm('u1', 'tests', 'insert', [{ id: 'a' }])), fixed)
                assert.strictEqual(await getReject(so2.procOrm('u1', 'tests', 'insert', [{ id: 'a' }])), fixed)
                assert.strictEqual(await getReject(so1.procOrm('u1', 'tests', 'mix', { add: [{ id: 'a' }] })), fixed)
            })
            assert.ok(!cap.text.includes(src.password + '@'), cap.text)
        })

        it('R11 錯誤自帶path為儲存路徑(Q3): 擴充函數reject之值身分不變、path完整; 同一錯誤經診斷細節時路徑遮罩', async function() {
            //dspec Q3: 對外錯誤值不遮儲存路徑; 診斷輸出仍遮(錯誤自帶之path併入該次detail清單)
            let c = getCase('R11')
            let ctx = mkCtx()
            let e = c.make(ctx)
            let err = await viaHook(ctx.sec.url, e)
            let { fun } = await viaOrmCatch(ctx.sec.url, e)
            let detail = fun[0][2]
            assert.ok(detail instanceof Error && detail !== e)
            assert.strictEqual(c.expect.check({ r: err, e, c: detail, p: e.path }), true)
        })

        it('R12 單獨帳號出現於後端訊息: 擴充函數reject之值不遮(身分不變), 診斷細節遮', async function() {
            //dspec §6.2: reject清單不含單獨帳號, detail清單含
            let c = getCase('R12')
            let ctx = mkCtx()
            let e = c.make(ctx)
            let err = await viaHook(ctx.sec.url, e)
            let { fun } = await viaOrmCatch(ctx.sec.url, e)
            assert.strictEqual(c.expect.check({ e, r: err, c: fun[0][2] }), true)
        })

        it('A01/A07 伺服端轉接器(下游w-web-*之用法): genDiagFunLog之funLog交本套件, write只收{ event, label, safe }, 細節不取(funLog只收2引數)', async function() {
            //dspec §6.7第5點、§6.8: funLog帶noDetail時不呼叫getDetail、不做拷貝; 下游以opt.funLog收本套件之診斷
            let ctx = mkCtx()
            let rs = []
            let { funLog } = genDiagFunLog((o) => rs.push(o), { event: 'x-diag' })
            let nArgs = []
            let f = (...a) => {
                nArgs.push(a.length)
                return funLog(...a)
            }
            f.noDetail = funLog.noDetail
            assert.strictEqual(f.noDetail, true)
            let so = WServOrm(DS, mkWOrm({ save: () => Promise.reject(new Error(`auth ${ctx.sec.password}`)) }), ctx.sec.url, 'db', { funLog: f })
            assert.strictEqual(await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a' }])), 'failed to save data')
            assert.deepStrictEqual(nArgs, [2])
            assert.deepStrictEqual(rs, [{ event: 'x-diag', label: 'tests.save catch', safe: { errType: 'Error' } }])
        })

        it('A11 下游以SAFE_KEYS宣告genDiagFunLog之safeKeys: 本套件之鍵(含errType、errCode)原樣轉寫, 名單外之鍵(含憑證鍵名、巢狀)丟棄', function() {
            //dspec §6.8、語料A11: safeKeys為轉接器寫入日誌前之第二道防線; 名單為本套件公開之SAFE_KEYS
            let ctx = mkCtx()
            let sample = getCase('A11').make(ctx) //{ n, ks, password, errType, errCode, sub }
            let rs = []
            genDiagFunLog((o) => rs.push(o), { safeKeys: SAFE_KEYS }).funLog('lb', sample)
            assert.deepStrictEqual(rs, [{ event: 'orm-diag', label: 'lb', safe: { n: 1, ks: [0], errType: 'Error', errCode: '23505' } }])
            assert.ok(!JSON.stringify(rs).includes(ctx.sec.password))
        })

        it('C14 真驅動形態(pg之DatabaseError, 實例name為error): 本套件不宣告驅動類別名, errType為Error; 集合外之實例name不列; errCode依宣告之sqlstate', async function() {
            //dspec §3.3、§6.6、語料C14: 類別名只列內建或宣告者(未宣告types); 本套件可搭配任一w-orm-*, 不替驅動宣告類別名
            let ctx = mkCtx()
            let e = getCase('C14').make(ctx)
            assert.strictEqual(e.name, 'error')
            let { fun } = await viaOrmCatch(ctx.sec.url, e)
            assert.deepStrictEqual(fun[0][1], { errType: 'Error', errCode: '23505' })
            let leak = Object.assign(e, { name: 'Alice01Leak' })
            let { fun: fun2 } = await viaOrmCatch(ctx.sec.url, leak)
            assert.deepStrictEqual(fun2[0][1], { errType: 'Error', errCode: '23505' })
            let { fun: fun3 } = await viaOrmCatch(ctx.sec.url, Object.assign(new TypeError('x'), { name: 'Alice01Leak' }))
            assert.deepStrictEqual(fun3[0][1], { errType: 'Error' })
        })

        it('U22 連線位址分類(getDiagSecrets({ conns: [url] }), 取代原getUrlSecrets): 連線字串之憑證於診斷細節與對外錯誤值皆遮, 儲存路徑只遮診斷細節(Q3)', async function() {
            //dspec §6.2、Q3、語料U22: 含://或@者為連線字串(帳密為憑證), 其餘為儲存路徑(對外錯誤值不遮); 兩種url各建一實例
            let ctx = mkCtx()
            let pw = ctx.sec.password
            let p = ctx.sec.path

            //連線字串
            let eUrl = new Error(`auth ${pw} via ${ctx.sec.url}`)
            let fun = []
            let so = WServOrm(DS, mkWOrm({ save: () => Promise.reject(eUrl) }), ctx.sec.url, 'db', { funLog: (...a) => fun.push(a) })
            await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a' }]))
            assert.ok(fun[0][2] instanceof Error && !fun[0][2].message.includes(pw) && !fun[0][2].message.includes(ctx.sec.url), fun[0][2].message)
            let errUrl = await viaHook(ctx.sec.url, eUrl)
            assert.ok(errUrl instanceof Error && errUrl !== eUrl && !errUrl.message.includes(pw) && !errUrl.message.includes(ctx.sec.url) && errUrl.message.includes('***'), errUrl.message)

            //儲存路徑(lowdb、lmdb等之url)
            let ePath = Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' })
            let fun2 = []
            let so2 = WServOrm(DS, mkWOrm({ save: () => Promise.reject(ePath) }), p, 'db', { funLog: (...a) => fun2.push(a) })
            await getReject(so2.procOrm('u1', 'tests', 'save', [{ id: 'a' }]))
            assert.ok(fun2[0][2] instanceof Error && !fun2[0][2].message.includes(p) && fun2[0][2].message.includes('***'), fun2[0][2].message)
            let errPath = await viaHook(p, ePath)
            assert.strictEqual(errPath, ePath, '對外錯誤值不遮儲存路徑, 無應處理者身分不變')
            assert.ok(errPath.message.includes(p))
        })

    })


    describe('B. 外來值之對外錯誤: 憑證移除(副本、同類別), 呼叫端原物件不變', function() {

        let ctx = mkCtx()
        let URL = ctx.sec.url
        let PW = ctx.sec.password
        let mkErr = (C = Error) => Object.assign(new C(`connect failed ${URL}`), { code: 'ECONNREFUSED' })
        let checkMasked = (got, orig, C = Error) => {
            //副本、同類別、訊息遮罩、code保留、原物件不變
            assert.ok(got !== orig, '應為副本')
            assert.ok(got instanceof C, `類別: ${util.inspect(got)}`)
            assert.ok(!String(got.message).includes(PW) && got.message.includes('***'), got.message)
            assert.strictEqual(got.code, 'ECONNREFUSED')
            assert.ok(orig.message.includes(PW), '呼叫端原錯誤物件不被改動')
        }

        it('B01 擴充函數(check、前處理、後處理)reject含連線網址之Error: procOrm轉出副本(同類別)', async function() {
            //dspec D3、§6.5第1點: 使用端回呼reject之值為外來值, 於catch站點經diag.err
            for (let name of ['addFunCheck', 'addFunPreProcessing', 'addFunPostProcessing']) {
                let so = WServOrm(DS, mkWOrm(), URL, 'db')
                let e = mkErr(RangeError)
                await addHook(so, name, () => Promise.reject(e))
                checkMasked(await getReject(so.procOrm('u1', 'tests', 'select', {})), e, RangeError)
            }
        })

        it('B02 擴充函數同步拋出含密碼之字串: procOrm轉出遮罩後之字串', async function() {
            //dspec §6.5: 字串之外來值以文字遮罩
            let so = WServOrm(DS, mkWOrm(), URL, 'db')
            await addHook(so, 'addFunPreProcessing', () => {
                throw `pre failed: password ${PW}` // eslint-disable-line no-throw-literal
            })
            assert.strictEqual(await getReject(so.procOrm('u1', 'tests', 'select', {})), 'pre failed: password ***')
        })

        it('B03 closeAll: ORM之close reject含連線網址之Error, 轉出副本', async function() {
            //dspec D3: ORM之錯誤為外來值
            let e = mkErr()
            let so = WServOrm(DS, mkWOrm({ close: () => Promise.reject(e) }), URL, 'db')
            checkMasked(await getReject(so.closeAll()), e)
        })

        it('B04 建構: ORM建構子拋出回顯連線網址之Error, WServOrm拋出副本', function() {
            //dspec D3、Q2: 建構期錯誤回顯之連線字串不含憑證
            let e = mkErr(TypeError)
            let got = getThrow(() => WServOrm(DS, mkWOrm({
                ctor: () => {
                    throw e
                }
            }), URL, 'db'))
            checkMasked(got, e, TypeError)
        })

        it('B05 實例上之backup與recover: ORM之select、insert、createStorage與模型產生器拋出之值經本實例之diag.err', async function() {
            //dspec D3、§6.5第7點: serv-orm工具路徑之對外錯誤值
            fs.writeFileSync(path.join(fd, 'bk.json'), JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
            let so = WServOrm(DS, mkWOrm(), URL, 'db')
            let e1 = null
            let cases = [
                ['backup select', () => so.backup({ tests: { select: async () => Promise.reject(e1) } })],
                ['recover insert', () => so.recover(path.join(fd, 'bk.json'), { tests: { insert: async () => Promise.reject(e1) } })],
                ['recover createStorage', () => so.recover(path.join(fd, 'bk.json'), { tests: { createStorage: async () => Promise.reject(e1), insert: async () => ({ ok: 1 }) } }, null, true)],
                ['recover genModels', () => so.recover(path.join(fd, 'bk.json'), { tests: { insert: async () => ({ ok: 1 }) } }, () => {
                    throw e1
                })],
            ]
            for (let [title, run] of cases) {
                e1 = mkErr()
                let cap = await capture(async () => {
                    checkMasked(await getReject(run()), e1)
                })
                assert.ok(!cap.text.includes(PW), `${title}: ${cap.text}`)
            }
        })

        it('B06 getDb.backup與getDb.recover(無登錄之秘密): 外來值仍以網址帳密、憑證鍵值對樣式遮罩', async function() {
            //dspec §6.3: 未登錄之秘密依網址帳密、鍵值對與Bearer樣式盡力遮罩; getDb無連線網址可宣告
            let e = new Error('connect mongodb://admin:hunter2x@h1:27017/db failed')
            let got = await capture(() => getReject(getDb.backup({ t1: { select: async () => Promise.reject(e) } }, { bLog: false })))
            assert.ok(got.text.indexOf('hunter2x') < 0, got.text)
            let err = await getReject(getDb.backup({ t1: { select: async () => Promise.reject(e) } }, { bLog: false, funLog: () => {} }))
            assert.strictEqual(err.message, 'connect mongodb://***@h1:27017/db failed')
            assert.ok(err !== e && e.message.includes('hunter2x'))
            fs.writeFileSync(path.join(fd, 'bk2.json'), JSON.stringify([{ name: 't1', data: [{ id: 'a' }] }]), 'utf8')
            let err2 = await getReject(getDb.recover({ t1: { insert: async () => Promise.reject('auth failed token=zz9TokQ8') } }, path.join(fd, 'bk2.json'), { bLog: false, funLog: () => {} }))
            assert.strictEqual(err2, 'auth failed token=***')
        })

        it('B07 genTestData: funTest、funTestAndSave、hookFunTestData與ORM之save拋出之值經diag.err', async function() {
            //dspec D3、§6.5第7點: serv-orm工具路徑之對外錯誤值; genTestData無連線網址, 依樣式遮罩
            let mkE = () => new Error('Bearer abc.def.ghi rejected')
            let rows = [{ id: 'a' }]
            let cases = [
                [{ t1: { funTest: async () => Promise.reject(mkE()) } }, {}, 'funTest'],
                [{ t1: { funTestAndSave: async () => Promise.reject(mkE()) } }, {}, 'funTestAndSave'],
                [{ t1: { funTest: async () => rows } }, { t1: { save: async () => Promise.reject(mkE()) } }, 'funTest'],
            ]
            for (let [ds, woItems, mode] of cases) {
                let err = await getReject(genTestData(ds, woItems, { mode, bLog: false }))
                assert.strictEqual(err.message, 'Bearer *** rejected', mode)
            }
            let err = await getReject(genTestData({ t1: { funTest: async () => rows } }, { t1: { save: async () => [{ ok: 1 }] } }, {
                mode: 'funTest',
                bLog: false,
                hookFunTestData: () => {
                    throw mkE()
                },
            }))
            assert.strictEqual(err.message, 'Bearer *** rejected')
        })

        it('B08 R02型(畸形網址之片段): 本實例之url為畸形網址, 擴充函數reject回顯其片段之錯誤 → 副本、同類別、code保留、片段遮罩、短帳號不遮', async function() {
            //語料R02之精神(處置表own): getDiagSecrets之畸形網址片段入reject清單
            let url = 'postgres://u1:p@ss/w0rdQ9@db.example.com/app'
            class DbErr extends Error {}
            let e = Object.assign(new DbErr('database "w0rdQ9@db.example.com/app" does not exist for user "u1"'), { code: '3D000' })
            let err = await viaHook(url, e)
            assert.ok(err !== e && err instanceof DbErr && err.code === '3D000')
            assert.ok(!err.message.includes('w0rdQ9') && err.message.includes('***') && err.message.includes('"u1"'), err.message)
        })

    })


    describe('C. 套件自身以固定詞彙組成之reject與throw: 原樣(密碼為固定詞彙之子字串時亦不被挖空)', function() {

        //密碼data(4字元, 入reject清單)為procOrm、recover等固定詞彙之子字串: 固定詞彙經遮罩即成'failed to save ***'而反推出密碼
        let URL = 'postgres://dbuser:data@db.example.com:5432/app'

        it('C01 procOrm各mode之固定reject逐字原樣(ORM reject、逐筆失敗、聚合ok:0、輸入檢查、mustExist)', async function() {
            //dspec §6.5第1點; R-MSG-01: 固定英文句型(逐筆失敗列主鍵)
            let rejOrm = () => Promise.reject(new Error(`conn ${URL}`))
            let cases = [
                [{ insert: rejOrm }, 'insert', [{ id: 'a' }], 'failed to insert data'],
                [{ insert: () => ({ ok: 0 }) }, 'insert', [{ id: 'a' }], 'failed to insert data'],
                [{ save: rejOrm }, 'save', [{ id: 'a' }], 'failed to save data'],
                [{ save: (d) => d.map(() => ({ n: 1, ok: 0, err: `x ${URL}` })) }, 'save', [{ id: 'a' }], 'failed to save data: id[a]'],
                [{ del: rejOrm }, 'del', [{ id: 'a' }], 'failed to delete data'],
                [{ delAll: rejOrm }, 'delAll', {}, 'failed to delete data'],
                [{ select: rejOrm }, 'select', {}, 'failed to select data'],
                [{ save: rejOrm }, 'mix', { diff: [{ id: 'a' }] }, 'failed to update data'],
                [{}, 'save', ['str'], 'failed to save data, not an object: data[0]'],
                [{}, 'mix', { add: [{ id: 'a' }], del: [{ id: 'a' }] }, 'invalid input of mix, same id in add and del: add[0], del[0]'],
                [{}, 'nomode', {}, 'invalid mode: nomode'],
            ]
            for (let [plan, mode, input, exp] of cases) {
                let so = WServOrm(DS, mkWOrm(plan), URL, 'db')
                let cap = await capture(async () => {
                    assert.strictEqual(await getReject(so.procOrm('u1', 'tests', mode, input)), exp, `${mode} ${exp}`)
                })
                assert.ok(!cap.text.includes('dbuser:data'), cap.text)
            }
            let so = WServOrm(DS, mkWOrm(), URL, 'db')
            assert.strictEqual(await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a' }], { mustExist: true })), 'rowNotFound')
            assert.strictEqual(await getReject(so.procOrm('u1', 'tests', 'insert', [{ id: 'a' }], { mustExist: true })), 'invalid opt of procOrm, mustExist supports only save and del')
        })

        it('C02 擴充函數之守門固定詞彙與前處理回傳檢核: 密碼function、data時逐字原樣', async function() {
            //dspec §6.5第1點: 守門函數之reject(addFunCheck註冊非函數)與前處理回傳不合之reject為套件之固定詞彙
            let so = WServOrm(DS, mkWOrm(), 'postgres://dbuser:function@db.example.com:5432/app', 'db')
            assert.throws(() => so.addFunCheck(undefined), /^Error: addFunCheck needs a function, but got undefined$/)
            assert.strictEqual(await getReject(so.procOrm('u1', 'tests', 'select', {})), 'addFunCheck needs a function, but got undefined')
            let so2 = WServOrm(DS, mkWOrm(), 'postgres://dbuser:input@db.example.com:5432/app', 'db')
            await addHook(so2, 'addFunPreProcessing', () => ({}))
            assert.strictEqual(await getReject(so2.procOrm('u1', 'tests', 'select', {})), 'invalid return of pre-processing, need an object with input')
        })

        it('C03 工具路徑之固定詞彙Error: recover之前綴與表名、無效參數之訊息逐字原樣', async function() {
            //dspec §6.5第1點; R-DB-01 規則3: recover失敗訊息之固定前綴與表名(部署者宣告之識別字)不經遮罩, 只遮ORM回傳原文之段
            fs.writeFileSync(path.join(fd, 'bk3.json'), JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
            let so = WServOrm(DS, mkWOrm(), URL, 'db')
            let cap = await capture(async () => {
                let err = await getReject(so.recover(path.join(fd, 'bk3.json'), { tests: { insert: async () => ({ n: 1, ok: 0, err: `conn ${URL}` }) } }))
                assert.ok(err.message.startsWith('failed to recover data into table[tests]: {"n":1,"ok":0,"err":"conn '), err.message)
                assert.ok(!err.message.includes('dbuser:data') && err.message.endsWith('***"}'), err.message)
                assert.strictEqual((await getReject(so.recover(path.join(fd, 'none-data.json'), { tests: {} }))).message, 'fp is not exist')
                assert.strictEqual((await getReject(so.backup('data'))).message, 'invalid woItems')
            })
            assert.ok(!cap.text.includes('dbuser:data'), cap.text)
            fs.writeFileSync(path.join(fd, 'bk4.json'), '[]', 'utf8')
            assert.strictEqual((await getReject(so.recover(path.join(fd, 'bk4.json'), { tests: {} }))).message, 'invalid backup data, need a non-empty array')
        })

    })


    describe('D. 逐筆結果之err: 含憑證者遮罩(工具路徑之Error訊息、診斷細節), 固定詞彙與主鍵原樣', function() {

        let ctx = mkCtx()
        let URL = ctx.sec.url
        let PW = ctx.sec.password

        it('D01 實例上之recover: insert之逐筆err含連線網址, Error訊息之err段遮罩、前綴與主鍵原樣', async function() {
            //dspec §6.5第7點(結果物件之逐筆err、serv-orm工具路徑之throw訊息經diag.mask); R-DB-01 規則3
            fs.writeFileSync(path.join(fd, 'bk5.json'), JSON.stringify([{ name: 'tests', data: [{ id: 'r1' }] }]), 'utf8')
            let so = WServOrm(DS, mkWOrm(), URL, 'db')
            let err = null
            await capture(async () => {
                err = await getReject(so.recover(path.join(fd, 'bk5.json'), { tests: { insert: async (d) => d.map(() => ({ n: 1, ok: 0, err: `dup key at ${URL}` })) } }))
            })
            assert.ok(err.message.startsWith('failed to recover data into table[tests]: [{"k":0,"id":"r1","err":"dup key at '), err.message)
            assert.ok(!err.message.includes(PW) && err.message.includes('***'), err.message)
        })

        it('D02 genTestData: save之逐筆err含憑證鍵值對, Error訊息之err段遮罩、前綴與主鍵原樣', async function() {
            //dspec §6.3第1點: 憑證鍵值對樣式; R-ORM-RESULT-01: 訊息列ORM回傳
            let err = await getReject(genTestData({ t1: { funTest: async () => [{ id: 'r1' }] } }, { t1: { save: async () => [{ n: 1, ok: 0, err: 'auth failed password=hunter22' }] } }, { mode: 'funTest', bLog: false }))
            assert.ok(err.message.startsWith('failed to write test data into table[t1]: [{"k":0,"id":"r1","err":"auth failed password=***'), err.message)
            assert.ok(!err.message.includes('hunter22'), err.message)
            let err2 = await getReject(genTestData({ t1: { funTest: async () => [{ id: 'r1' }] } }, { t1: { save: async () => ({ n: 1, ok: 0, err: 'auth failed password=hunter22' }) } }, { mode: 'funTest', bLog: false }))
            assert.ok(err2.message.startsWith('failed to write test data into table[t1]: {"n":1,"ok":0,"err":"auth failed password=***'), err2.message)
            assert.ok(!err2.message.includes('hunter22'), err2.message)
        })

        it('D03 procOrm之逐筆失敗: reject只列主鍵(固定句型), funLog之細節[{k,id,err}]之err遮罩, 主鍵原樣', async function() {
            //R-MSG-01; dspec D2: 細節遮罩憑證, 識別值(id)不在遮罩範圍
            let fun = []
            let so = WServOrm(DS, mkWOrm({ save: (d) => d.map(() => ({ n: 1, ok: 0, err: `denied for ${URL}` })) }), URL, 'db', { funLog: (...a) => fun.push(a) })
            assert.strictEqual(await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'u-1@example.com' }])), 'failed to save data: id[u-1@example.com]')
            assert.strictEqual(fun.length, 1)
            assert.deepStrictEqual(fun[0].slice(0, 2), ['tests.save fail', { n: 1, ks: [0] }])
            let d = fun[0][2]
            assert.strictEqual(d.length, 1)
            assert.strictEqual(d[0].id, 'u-1@example.com')
            assert.ok(!d[0].err.includes(PW) && d[0].err.includes('***'), d[0].err)
        })

        it('D04 getDb.recover(無登錄之秘密): 逐筆err之網址帳密以樣式遮罩', async function() {
            //dspec §6.3: 網址帳密樣式
            fs.writeFileSync(path.join(fd, 'bk6.json'), JSON.stringify([{ name: 't1', data: [{ id: 'r1' }] }]), 'utf8')
            let err = await getReject(getDb.recover({ t1: { insert: async (d) => d.map(() => ({ n: 1, ok: 0, err: 'at mongodb://admin:pw9988xx@h1/db' })) } }, path.join(fd, 'bk6.json'), { bLog: false, funLog: () => {} }))
            assert.strictEqual(err.message, 'failed to recover data into table[t1]: [{"k":0,"id":"r1","err":"at mongodb://***@h1/db"}]')
        })

    })


    describe('E. 診斷輸出之串流: 全部寫console.log(stdout), 不寫console.error', function() {

        it('E01 代表站點(procOrm之catch與逐筆失敗、建構之無效參數、recover與backup之進度與失敗、getDb之catch)於預設與logDetail皆只寫console.log', async function() {
            //dspec §6.7第2點: 舊參數bare換為level, 本套件之站點舊版皆為console.log, 一律不帶level(串流不變; 子行程之真實stdout/stderr見api-diaglog)
            fs.writeFileSync(path.join(fd, 'bk7.json'), JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
            for (let opt of [{}, { logDetail: true }]) {
                let cap = await capture(async () => {
                    let so = WServOrm(DS, mkWOrm({ save: () => Promise.reject(new Error('x')), del: (d) => d.map(() => ({ n: 1, ok: 0 })) }), 'url', 'db', opt)
                    await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a' }]))
                    await getReject(so.procOrm('u1', 'tests', 'del', [{ id: 'a' }]))
                    getThrow(() => WServOrm(DS, mkWOrm(), 123, 'db', opt))
                    await getReject(so.recover(path.join(fd, 'bk7.json'), { tests: { insert: async () => ({ ok: 0 }) } }))
                    await so.backup({ tests: { select: async () => [] } })
                    await getReject(getDb.backup({ tests: { select: async () => Promise.reject(new Error('y')) } }, { bLog: false, ...opt }))
                })
                assert.deepStrictEqual(cap.errs, [], JSON.stringify(opt))
                assert.deepStrictEqual(cap.logs.map((a) => a[0]), ['tests.save catch', 'tests.del fail', 'url', 'recover...', 'tests.insert fail', 'backup...', 'backup...', 'backup catch'], JSON.stringify(opt))
            }
        })

    })


    describe('F. 站點全集之靜態盤點(對外錯誤值之diag.err、diag.mask)', function() {

        it('F01 各檔之diag.err與diag.mask站點數同帳本R-DIAG-01之站點表; getMapOrm之reject全為固定詞彙(無diag.err)', function() {
            //dspec §6.5第7點: 出口全集以Grep列全; 新增站點須先於帳本歸類並更新此表
            let exp = {
                'WServOrm.mjs': [1, 0],
                'genTestData.mjs': [2, 2],
                'getDb.mjs': [1, 0],
                'getDbBackupAndRecover.mjs': [6, 2],
                'getDiagBrief.mjs': [0, 0],
                'getMapOrm.mjs': [0, 0],
                'getProc.mjs': [1, 0],
                'getSettings.mjs': [0, 0],
                'getWoItems.mjs': [1, 0],
            }
            let got = {}
            for (let f of Object.keys(exp)) {
                let code = srcOf(f)
                got[f] = [count(code, /diag\.err\(/g), count(code, /diag\.mask\(/g)]
            }
            assert.deepStrictEqual(got, exp)
        })

    })

})
