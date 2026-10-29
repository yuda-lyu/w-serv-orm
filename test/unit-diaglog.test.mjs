import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'
import { getDiag, getBriefResult, getOptLogLoose, cpDetail } from '../src/getDiag.mjs'
import { cpuMsSync } from './tools/cpuBound.mjs'


//R-DIAG-01(orm-run01, 來源: w-web-perm 建議書 Gitea #12): procOrm各路徑之診斷輸出預設不含主鍵、資料值與ORM錯誤原文,
//opt.logDetail為true還原完整細節, opt.funLog(label, safe, detail)取代console並收完整細節; 回傳契約(resolve與reject)不因選項而變
//替身ORM的失敗皆夾帶 SECRET(使用者識別, 含email)與 ERRTXT(ORM錯誤原文), 預設輸出出現任一即為洩漏
let SECRET = 'u-secret@example.com'
let ERRTXT = 'E-raw-9f3a duplicate key'
let DS = { tests: { keys: ['id', 'name'] } }


function mkWOrm(plan = {}) {
    //plan[fn]: 回傳(或reject)的非同步函數; plan.raw[fn]: 直接掛在ORM上的函數(可同步拋錯)
    return function() {
        let ev = {}
        for (let fn of ['select', 'insert', 'save', 'del', 'delAll']) {
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
        for (let [fn, f] of Object.entries(plan.raw || {})) {
            ev[fn] = f
        }
        return ev
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

async function capture(fn) {
    //以 util.format 格式化(同真console.log)收集輸出
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

let rejStr = (s) => () => Promise.reject(s)
let rejErr = (s) => () => Promise.reject(new Error(s))
let throwErr = (s) => () => {
    throw new Error(s)
}
let nullValue = null
let throwNull = () => {
    throw nullValue //拋出null(非Error物件)
}
let isErr = (re) => (args) => {
    assert.strict.equal(args.length, 1)
    assert.ok(args[0] instanceof Error && re.test(args[0].message), String(args[0]))
}
let isStr = (re) => (args) => {
    assert.strict.equal(args.length, 1)
    assert.ok(typeof args[0] === 'string' && re.test(args[0]), String(args[0]))
}
let RAW = new RegExp(ERRTXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

//路徑表: 每列為一條失敗路徑, 涵蓋 src/getMapOrm.mjs 全部診斷輸出站點(R-DIAG-01 站點全集)
//mode: procOrm之mode; input: 產生輸入的函數(每次取新物件); opt: procOrm第5參數; ds; plan: 替身ORM的行為
//reject: 固定的reject值; label: 唯一一次診斷輸出的標籤; safe: 預設輸出的摘要(函數者以reject值計算); detail: logDetail與funLog收到的細節(逐引數, 函數者為斷言)
//leak: 該路徑的細節是否夾帶 SECRET 或 ERRTXT(true者, logDetail須還原出來)
let ROWS = () => [{ id: SECRET, name: 'a' }]
let PATHS = [
    //insert
    { id: 'P01', title: 'insert之ORM以字串reject', mode: 'insert', input: ROWS, plan: { insert: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to insert data', label: 'tests.insert catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P02', title: 'insert之ORM以Error reject', mode: 'insert', input: ROWS, plan: { insert: rejErr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to insert data', label: 'tests.insert catch', safe: { errType: 'Error' }, detail: isErr(RAW), leak: true },
    { id: 'P03', title: 'insert之ORM回聚合物件ok為0', mode: 'insert', input: ROWS, plan: { insert: () => ({ n: 1, ok: 0, err: `${ERRTXT} ${SECRET}` }) }, reject: 'failed to insert data', label: 'tests.insert fail', safe: { ok: 0 }, detail: [{ n: 1, ok: 0, err: `${ERRTXT} ${SECRET}` }], leak: true },
    { id: 'P04', title: 'insert之ORM回逐筆陣列且有ok為0', mode: 'insert', input: ROWS, plan: { insert: () => [{ n: 1, ok: 0, err: ERRTXT }] }, reject: 'failed to insert data', label: 'tests.insert fail', safe: { n: 1, ks: [0] }, detail: [[{ n: 1, ok: 0, err: ERRTXT }]], leak: true },
    //save
    { id: 'P05', title: 'save之ORM以字串reject', mode: 'save', input: ROWS, plan: { save: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to save data', label: 'tests.save catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P06', title: 'save之逐筆失敗(reject值依契約列主鍵)', mode: 'save', input: ROWS, plan: { save: (d) => d.map(() => ({ n: 1, ok: 0, err: ERRTXT })) }, reject: `failed to save data: id[${SECRET}]`, label: 'tests.save fail', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: SECRET, err: ERRTXT }]], leak: true },
    { id: 'P07', title: 'save之ORM回聚合物件ok為0', mode: 'save', input: ROWS, plan: { save: () => ({ n: 1, ok: 0, err: ERRTXT }) }, reject: 'failed to save data', label: 'tests.save fail', safe: { ok: 0 }, detail: [{ n: 1, ok: 0, err: ERRTXT }], leak: true },
    { id: 'P08', title: 'save之mustExist存在檢查的select失敗', mode: 'save', input: ROWS, opt: { mustExist: true }, plan: { select: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to save data', label: 'tests.save exist check catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    //del
    { id: 'P09', title: 'del之ORM以字串reject', mode: 'del', input: ROWS, plan: { del: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to delete data', label: 'tests.del catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P10', title: 'del之逐筆失敗(reject值依契約列主鍵)', mode: 'del', input: ROWS, plan: { del: (d) => d.map(() => ({ n: 1, ok: 0, err: ERRTXT })) }, reject: `failed to delete data: id[${SECRET}]`, label: 'tests.del fail', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: SECRET, err: ERRTXT }]], leak: true },
    { id: 'P11', title: 'del之ORM回聚合物件ok為0', mode: 'del', input: ROWS, plan: { del: () => ({ n: 1, ok: 0, err: ERRTXT }) }, reject: 'failed to delete data', label: 'tests.del fail', safe: { ok: 0 }, detail: [{ n: 1, ok: 0, err: ERRTXT }], leak: true },
    { id: 'P12', title: 'del之mustExist存在檢查的select失敗', mode: 'del', input: ROWS, opt: { mustExist: true }, plan: { select: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to delete data', label: 'tests.del exist check catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    //delAll, select
    { id: 'P13', title: 'delAll之ORM以字串reject', mode: 'delAll', input: () => ({}), plan: { delAll: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to delete data', label: 'tests.delAll catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P14', title: 'delAll之ORM回聚合物件ok為0', mode: 'delAll', input: () => ({}), plan: { delAll: () => ({ n: 0, ok: 0, err: ERRTXT }) }, reject: 'failed to delete data', label: 'tests.delAll fail', safe: { ok: 0 }, detail: [{ n: 0, ok: 0, err: ERRTXT }], leak: true },
    { id: 'P15', title: 'select之ORM以字串reject', mode: 'select', input: () => ({}), plan: { select: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to select data', label: 'tests.select catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    //mix
    { id: 'P16', title: 'mix之add的ORM以字串reject', mode: 'mix', input: () => ({ add: ROWS() }), plan: { insert: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to insert data', label: 'tests.insert catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P17', title: 'mix之add回聚合物件ok為0', mode: 'mix', input: () => ({ add: ROWS() }), plan: { insert: () => ({ n: 1, ok: 0, err: ERRTXT }) }, reject: 'failed to insert data', label: 'tests.insert fail', safe: { ok: 0 }, detail: [{ n: 1, ok: 0, err: ERRTXT }], leak: true },
    { id: 'P18', title: 'mix之del的ORM以字串reject', mode: 'mix', input: () => ({ del: [{ id: SECRET }] }), plan: { del: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to delete data', label: 'tests.del catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P19', title: 'mix之del逐筆失敗', mode: 'mix', input: () => ({ del: [{ id: SECRET }] }), plan: { del: (d) => d.map(() => ({ n: 1, ok: 0, err: ERRTXT })) }, reject: `failed to delete data: id[${SECRET}]`, label: 'tests.del fail', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: SECRET, err: ERRTXT }]], leak: true },
    { id: 'P20', title: 'mix之del回聚合物件ok為0', mode: 'mix', input: () => ({ del: [{ id: SECRET }] }), plan: { del: () => ({ n: 1, ok: 0, err: ERRTXT }) }, reject: 'failed to delete data', label: 'tests.del fail', safe: { ok: 0 }, detail: [{ n: 1, ok: 0, err: ERRTXT }], leak: true },
    { id: 'P21', title: 'mix之diff的ORM以字串reject', mode: 'mix', input: () => ({ diff: ROWS() }), plan: { save: rejStr(`${ERRTXT} ${SECRET}`) }, reject: 'failed to update data', label: 'tests.save catch', safe: { errType: 'string' }, detail: [`${ERRTXT} ${SECRET}`], leak: true },
    { id: 'P22', title: 'mix之diff逐筆失敗', mode: 'mix', input: () => ({ diff: ROWS() }), plan: { save: (d) => d.map(() => ({ n: 1, ok: 0, err: ERRTXT })) }, reject: `failed to update data: id[${SECRET}]`, label: 'tests.save fail', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: SECRET, err: ERRTXT }]], leak: true },
    { id: 'P23', title: 'mix之diff回聚合物件ok為0', mode: 'mix', input: () => ({ diff: ROWS() }), plan: { save: () => ({ n: 1, ok: 0, err: ERRTXT }) }, reject: 'failed to update data', label: 'tests.save fail', safe: { ok: 0 }, detail: [{ n: 1, ok: 0, err: ERRTXT }], leak: true },
    //輸入檢查(主鍵會被clearXSS改寫)
    { id: 'P24', title: 'save之主鍵含HTML標記', mode: 'save', input: () => [{ id: `${SECRET}<b`, name: 'a' }], plan: {}, reject: 'failed to save data, id contains HTML markup: data[0]', label: 'tests.save id changed by clearXSS', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: `${SECRET}<b` }]], leak: true },
    { id: 'P25', title: 'mix之add主鍵含HTML標記', mode: 'mix', input: () => ({ add: [{ id: `${SECRET}<b`, name: 'a' }] }), plan: {}, reject: 'failed to insert data, id contains HTML markup: data[0]', label: 'tests.mix add id changed by clearXSS', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: `${SECRET}<b` }]], leak: true },
    //被拒之find(診斷輸出為輸入快照, 含條件中的使用者識別)
    { id: 'P26', title: 'select之條件含自有__proto__鍵', mode: 'select', input: () => JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`), plan: {}, reject: 'invalid find of select, unsupported key[__proto__]', label: 'tests.select invalid find', safe: { reason: 'invalid find of select, unsupported key[__proto__]' }, detail: [JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`)], leak: true },
    { id: 'P27', title: 'delAll之條件含自有__proto__鍵', mode: 'delAll', input: () => JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`), plan: {}, reject: 'invalid find of delAll, unsupported key[__proto__]', label: 'tests.delAll invalid find', safe: { reason: 'invalid find of delAll, unsupported key[__proto__]' }, detail: [JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`)], leak: true },
    //邊界保證: ORM同步拋出(非字串)
    { id: 'P28', title: 'ORM同步拋出Error(邊界保證)', mode: 'save', input: ROWS, plan: { raw: { save: throwErr(`${ERRTXT} ${SECRET}`) } }, reject: 'failed to process input', label: 'tests.save mapOrm catch', safe: { errType: 'Error' }, detail: isErr(RAW), leak: true },
    //adjustData(ds缺keys令其拋TypeError)
    { id: 'P29', title: 'save之adjustData拋錯', mode: 'save', input: ROWS, ds: { tests: {} }, plan: {}, reject: 'failed to adjust data', label: 'tests.adjustData catch', safe: { errType: 'TypeError' }, detail: isStr(/^TypeError: /), leak: false },
    { id: 'P30', title: 'mix之add的adjustData拋錯', mode: 'mix', input: () => ({ add: ROWS() }), ds: { tests: {} }, plan: {}, reject: 'failed to adjust data', label: 'tests.adjustData catch', safe: { errType: 'TypeError' }, detail: isStr(/^TypeError: /), leak: false },
    { id: 'P31', title: 'mix之diff的adjustData拋錯', mode: 'mix', input: () => ({ diff: ROWS() }), ds: { tests: {} }, plan: {}, reject: 'failed to adjust data', label: 'tests.adjustData catch', safe: { errType: 'TypeError' }, detail: isStr(/^TypeError: /), leak: false },
    //只有位置或固定句型(本就不含主鍵與原文): 仍經同一出口, 供funLog收到
    { id: 'P32', title: 'save之列不是物件', mode: 'save', input: () => ['str'], plan: {}, reject: 'failed to save data, not an object: data[0]', label: 'tests.save data is not an object', safe: { n: 1, ks: [0] }, detail: [[{ k: 0 }]], leak: false },
    { id: 'P33', title: 'save之列含自有__proto__鍵', mode: 'save', input: () => [JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`)], plan: {}, reject: 'failed to save data, unsupported key[__proto__]: data[0]', label: 'tests.save data has unsupported key', safe: (rej) => [rej], detail: (args, rej) => assert.strict.deepEqual(args, [[rej]]), leak: false },
    { id: 'P34', title: 'save之批次容器有空洞', mode: 'save', input: () => new Array(2), plan: {}, reject: 'failed to save data, unsupported sparse array: data[0]', label: 'tests.save invalid batch container', safe: undefined, detail: undefined, leak: false },
    { id: 'P35', title: 'save之mustExist查無該列', mode: 'save', input: ROWS, opt: { mustExist: true }, plan: {}, reject: 'rowNotFound', label: 'tests.save row not found', safe: undefined, detail: undefined, leak: false },
    { id: 'P36', title: 'del之mustExist同批重複主鍵', mode: 'del', input: () => [{ id: SECRET }, { id: SECRET }], opt: { mustExist: true }, plan: {}, reject: 'invalid input of del, duplicate id: data[1]', label: 'tests.del duplicate id', safe: { n: 1, ks: [1] }, detail: [[{ k: 1 }]], leak: false },
    { id: 'P37', title: 'del之mustExist查無該列', mode: 'del', input: ROWS, opt: { mustExist: true }, plan: {}, reject: 'rowNotFound', label: 'tests.del row not found', safe: undefined, detail: undefined, leak: false },
    { id: 'P38', title: 'mix之add同批含同鍵於add與del', mode: 'mix', input: () => ({ add: [{ id: SECRET, name: 'a' }], del: [{ id: SECRET }] }), plan: {}, reject: 'invalid input of mix, same id in add and del: add[0], del[0]', label: 'tests.mix same id across steps', safe: (rej) => [rej], detail: (args, rej) => assert.strict.deepEqual(args, [[rej]]), leak: false },
    //事後偵測與其餘輸入檢查(外審 terra F17: 路徑表須涵蓋src全部診斷站點, S03機械比對)
    { id: 'P39', title: 'save之mustExist事後偵測未命中', mode: 'save', input: ROWS, opt: { mustExist: true }, plan: { select: () => [{ id: SECRET }], save: (d) => d.map(() => ({ n: 0, ok: 1 })) }, reject: 'rowNotFound', label: 'tests.save row not found after check', safe: undefined, detail: undefined, leak: false },
    { id: 'P40', title: 'del之批次容器有空洞', mode: 'del', input: () => new Array(2), plan: {}, reject: 'failed to delete data, unsupported sparse array: data[0]', label: 'tests.del invalid batch container', safe: undefined, detail: undefined, leak: false },
    { id: 'P41', title: 'del之mustExist事後偵測未命中', mode: 'del', input: ROWS, opt: { mustExist: true }, plan: { select: () => [{ id: SECRET }], del: (d) => d.map(() => ({ n: 0, nDeleted: 0, ok: 1 })) }, reject: 'rowNotFound', label: 'tests.del row not found after check', safe: undefined, detail: undefined, leak: false },
    { id: 'P42', title: 'mix之add批次容器有空洞', mode: 'mix', input: () => ({ add: new Array(2) }), plan: {}, reject: 'failed to insert data, unsupported sparse array: data[0]', label: 'tests.mix invalid batch container', safe: undefined, detail: undefined, leak: false },
    { id: 'P43', title: 'mix之add列不是物件', mode: 'mix', input: () => ({ add: ['str'] }), plan: {}, reject: 'failed to insert data, not an object: data[0]', label: 'tests.mix add data is not an object', safe: { n: 1, ks: [0] }, detail: [[{ k: 0 }]], leak: false },
    { id: 'P44', title: 'mix之diff列不是物件', mode: 'mix', input: () => ({ diff: ['str'] }), plan: {}, reject: 'failed to update data, not an object: data[0]', label: 'tests.mix diff data is not an object', safe: { n: 1, ks: [0] }, detail: [[{ k: 0 }]], leak: false },
    { id: 'P45', title: 'mix之add列含自有__proto__鍵', mode: 'mix', input: () => ({ add: [JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`)] }), plan: {}, reject: 'failed to insert data, unsupported key[__proto__]: data[0]', label: 'tests.mix data has unsupported key', safe: (rej) => [rej], detail: (args, rej) => assert.strict.deepEqual(args, [[rej]]), leak: false },
    { id: 'P46', title: 'mix之del列的id為繼承而來', mode: 'mix', input: () => ({ del: [Object.create({ id: SECRET })] }), plan: {}, reject: 'failed to delete data, unsupported irregular object or array: data[0]', label: 'tests.mix del id is not an own data property', safe: { n: 1, ks: [0] }, detail: [[{ k: 0 }]], leak: false },
    { id: 'P47', title: 'mix之diff主鍵含HTML標記', mode: 'mix', input: () => ({ diff: [{ id: `${SECRET}<b`, name: 'a' }] }), plan: {}, reject: 'failed to update data, id contains HTML markup: data[0]', label: 'tests.mix diff id changed by clearXSS', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: `${SECRET}<b` }]], leak: true },
    { id: 'P48', title: 'insert之列不是物件', mode: 'insert', input: () => ['str'], plan: {}, reject: 'failed to insert data, not an object: data[0]', label: 'tests.insert data is not an object', safe: { n: 1, ks: [0] }, detail: [[{ k: 0 }]], leak: false },
    { id: 'P49', title: 'insert之列含自有__proto__鍵', mode: 'insert', input: () => [JSON.parse(`{"__proto__":1,"id":"${SECRET}"}`)], plan: {}, reject: 'failed to insert data, unsupported key[__proto__]: data[0]', label: 'tests.insert data has unsupported key', safe: (rej) => [rej], detail: (args, rej) => assert.strict.deepEqual(args, [[rej]]), leak: false },
    { id: 'P50', title: 'insert之主鍵含HTML標記', mode: 'insert', input: () => [{ id: `${SECRET}<b`, name: 'a' }], plan: {}, reject: 'failed to insert data, id contains HTML markup: data[0]', label: 'tests.insert id changed by clearXSS', safe: { n: 1, ks: [0] }, detail: [[{ k: 0, id: `${SECRET}<b` }]], leak: true },
    { id: 'P51', title: 'insert之adjustData拋錯', mode: 'insert', input: ROWS, ds: { tests: {} }, plan: {}, reject: 'failed to adjust data', label: 'tests.adjustData catch', safe: { errType: 'TypeError' }, detail: isStr(/^TypeError: /), leak: false },
    { id: 'P52', title: 'insert之批次容器有空洞', mode: 'insert', input: () => new Array(2), plan: {}, reject: 'failed to insert data, unsupported sparse array: data[0]', label: 'tests.insert invalid batch container', safe: undefined, detail: undefined, leak: false },
]


async function runPath(p, optWS) {
    //執行一條路徑: 回傳 { reject, calls, text, fun }; fun為funLog收到的 [label, safe, ...detail]
    let fun = []
    let opt = optWS === undefined ? undefined : { ...optWS }
    if (opt && opt.funLog === true) {
        opt.funLog = (...a) => {
            fun.push(a)
        }
    }
    let so = WServOrm(p.ds || DS, mkWOrm(p.plan), 'url', 'db', opt)
    let reject = null
    let cap = await capture(async () => {
        reject = await getReject(so.procOrm('u1', 'tests', p.mode, p.input(), p.opt))
    })
    return { reject, ...cap, fun }
}

function expectSafe(p, rej) {
    return typeof p.safe === 'function' ? p.safe(rej) : p.safe
}

function checkDetail(p, args, rej) {
    //p.detail: undefined(無細節), 函數(斷言引數陣列與reject值), 其餘(與引數陣列深度相等)
    if (p.detail === undefined) {
        assert.strict.deepEqual(args, [], `${p.id}: 無細節`)
    }
    else if (typeof p.detail === 'function') {
        p.detail(args, rej)
    }
    else {
        assert.strict.deepEqual(args, p.detail, `${p.id}: 細節`)
    }
}


describe('診斷輸出預設不含主鍵與錯誤原文(R-DIAG-01)', function() {

    for (let p of PATHS) {
        it(`${p.id} ${p.title}: 預設只輸出標籤與摘要, reject值不變`, async function() {
            //R-DIAG-01 規則1: 預設輸出不含主鍵值與ORM錯誤原文, 只含標籤、筆數、位置、錯誤類別; 規則4: reject值同契約
            let r = await runPath(p, undefined)
            assert.strict.equal(r.reject, p.reject)
            assert.strict.equal(r.calls.length, 1, `輸出次數(舊版為1次): ${r.text}`)
            let safe = expectSafe(p, r.reject)
            let exp = safe === undefined ? [p.label] : [p.label, safe]
            assert.strict.deepEqual(r.calls[0], exp)
            assert.ok(!r.text.includes(SECRET), `預設輸出含使用者識別: ${r.text}`)
            assert.ok(!r.text.includes(ERRTXT), `預設輸出含ORM錯誤原文: ${r.text}`)
        })
    }

})


describe('opt.logDetail為true還原完整細節(R-DIAG-01)', function() {

    for (let p of PATHS) {
        it(`${p.id} ${p.title}: 還原為舊版輸出, reject值不變`, async function() {
            //R-DIAG-01 規則3: logDetail為true時console輸出同舊版(標籤接完整細節)
            let r = await runPath(p, { logDetail: true })
            assert.strict.equal(r.reject, p.reject)
            assert.strict.equal(r.calls.length, 1)
            assert.strict.equal(r.calls[0][0], p.label)
            checkDetail(p, r.calls[0].slice(1), r.reject)
            if (p.leak) {
                assert.ok(r.text.includes(SECRET) || r.text.includes(ERRTXT), `細節應含主鍵或原文: ${r.text}`)
            }
        })
    }

})


describe('opt.funLog收完整細節並取代console(R-DIAG-01)', function() {

    for (let p of PATHS) {
        it(`${p.id} ${p.title}: funLog收(標籤, 摘要, 細節), console無輸出, reject值不變`, async function() {
            //R-DIAG-01 規則3: 注入之紀錄函式收到完整細節供使用端遮罩或轉送; 給予時本套件不寫console
            let r = await runPath(p, { funLog: true })
            assert.strict.equal(r.reject, p.reject)
            assert.strict.deepEqual(r.calls, [], `console應無輸出: ${r.text}`)
            assert.strict.equal(r.fun.length, 1)
            let [label, safe, ...detail] = r.fun[0]
            assert.strict.equal(label, p.label)
            assert.strict.deepEqual(safe, expectSafe(p, r.reject))
            checkDetail(p, detail, r.reject)
        })
    }

})


describe('回傳契約不因診斷選項而變(R-DIAG-01 規則4)', function() {

    it('C01 各路徑在預設、logDetail、funLog三種設定下之reject值皆相同', async function() {
        //R-DIAG-01 規則4: 只動診斷輸出, procOrm之resolve與reject內容與時機不變
        for (let p of PATHS) {
            let rs = []
            for (let optWS of [undefined, { logDetail: false }, { logDetail: true }, { funLog: true }, { logDetail: true, funLog: true }]) {
                rs.push((await runPath(p, optWS)).reject)
            }
            assert.strict.deepEqual(rs, rs.map(() => p.reject), p.id)
        }
    })

    it('C02 成功路徑之resolve值與ORM呼叫在三種設定下相同, 且無診斷輸出', async function() {
        //R-DIAG-01 規則4: 成功路徑不輸出診斷, 結果不變
        let outs = []
        for (let optWS of [undefined, { logDetail: true }, { funLog: () => {} }]) {
            let calls = []
            let WOrm = function() {
                let ev = {}
                for (let fn of ['select', 'insert', 'save', 'del', 'delAll']) {
                    ev[fn] = async (d) => {
                        calls.push([fn, d])
                        return fn === 'save' || fn === 'del' ? (Array.isArray(d) ? d : [d]).map(() => ({ n: 1, ok: 1 })) : { n: 1, ok: 1 }
                    }
                }
                return ev
            }
            let so = WServOrm(DS, WOrm, 'url', 'db', optWS)
            let got = null
            let cap = await capture(async () => {
                got = [
                    await so.procOrm('u1', 'tests', 'save', [{ id: 'a', name: 'x' }]),
                    await so.procOrm('u1', 'tests', 'del', [{ id: 'a' }]),
                    await so.procOrm('u1', 'tests', 'mix', { add: [{ id: 'b' }], del: [{ id: 'c' }], diff: [{ id: 'd' }] }),
                ]
            })
            assert.strict.deepEqual(cap.calls, [])
            outs.push({ got, calls })
        }
        assert.strict.deepEqual(outs[1], outs[0])
        assert.strict.deepEqual(outs[2], outs[0])
    })

})


describe('診斷選項之建構與行為(R-DIAG-01)', function() {

    it('O01 logDetail非布林、funLog非函數即建構拋Error且不建立ORM; 未給與null照常', function() {
        //R-DIAG-01 規則3: 選項型別錯誤於建構時拋Error(同建構期其他設定), 且早於建立ORM
        let created = 0
        let WOrmCount = function() {
            created++
            return {}
        }
        let bads = [['logDetail', 'true'], ['logDetail', 1], ['logDetail', {}], ['funLog', 'x'], ['funLog', true], ['funLog', {}]]
        for (let [k, v] of bads) {
            assert.throws(() => WServOrm(DS, WOrmCount, 'url', 'db', { [k]: v }), (e) => e instanceof Error && e.message === (k === 'logDetail' ? 'invalid opt.logDetail, need a boolean' : 'invalid opt.funLog, need a function'), `${k}: ${String(v)}`)
        }
        assert.strict.equal(created, 0)
        for (let opt of [undefined, null, {}, { logDetail: undefined }, { logDetail: null, funLog: null }, { logDetail: false }, { funLog: () => {} }]) {
            WServOrm(DS, WOrmCount, 'url', 'db', opt)
        }
        assert.strict.equal(created, 7)
    })

    it('O02 funLog優先於logDetail: 兩者皆給時console無輸出, funLog仍收完整細節', async function() {
        //R-DIAG-01 規則3: funLog為單一出口
        let p = PATHS.find((v) => v.id === 'P06')
        let r = await runPath(p, { logDetail: true, funLog: true })
        assert.strict.deepEqual(r.calls, [])
        assert.strict.deepEqual(r.fun[0].slice(2), p.detail)
    })

    it('O03 funLog同步拋錯、回傳rejected promise、async函數拋錯: procOrm之reject值不變且無未處理拒絕', async function() {
        //R-DIAG-01 規則4: 使用端的紀錄函式出錯不得改變procOrm之結果, 亦不得產生unhandledRejection(取細節拋錯見O10; 惡意之promise/thenable〔constructor或species拋錯〕不在保證內, 見規則帳本)
        let unhandled = []
        let h = (e) => {
            unhandled.push(e)
        }
        process.on('unhandledRejection', h)
        try {
            let p = PATHS.find((v) => v.id === 'P06')
            let boomAsync = async () => {
                throw new Error('boom-async2')
            }
            for (let funLog of [throwErr('boom'), () => Promise.reject(new Error('boom-async')), boomAsync]) {
                let so = WServOrm(DS, mkWOrm(p.plan), 'url', 'db', { funLog })
                let cap = await capture(async () => {
                    assert.strict.equal(await getReject(so.procOrm('u1', 'tests', 'save', ROWS())), p.reject)
                })
                assert.strict.deepEqual(cap.calls, [])
            }
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        finally {
            process.off('unhandledRejection', h)
        }
        assert.strict.deepEqual(unhandled, [])
    })

    it('O04 實例各自持有診斷設定, 互不干擾', async function() {
        //R-DIAG-01(同R-INST-01): 同一行程內多實例之funLog與logDetail各屬其實例
        let p = PATHS.find((v) => v.id === 'P06')
        let funA = []
        let A = WServOrm(DS, mkWOrm(p.plan), 'url', 'db', { funLog: (...a) => funA.push(a) })
        let B = WServOrm(DS, mkWOrm(p.plan), 'url', 'db')
        let C = WServOrm(DS, mkWOrm(p.plan), 'url', 'db', { logDetail: true })
        let cap = await capture(async () => {
            await getReject(A.procOrm('u1', 'tests', 'save', ROWS()))
            await getReject(B.procOrm('u1', 'tests', 'save', ROWS()))
            await getReject(C.procOrm('u1', 'tests', 'save', ROWS()))
        })
        assert.strict.equal(funA.length, 1)
        assert.strict.equal(cap.calls.length, 2)
        assert.strict.deepEqual(cap.calls[0], ['tests.save fail', { n: 1, ks: [0] }])
        assert.strict.deepEqual(cap.calls[1], ['tests.save fail', [{ k: 0, id: SECRET, err: ERRTXT }]])
    })

    it('O05 失敗超過10筆時摘要只列前10筆位置並附總筆數', async function() {
        //R-DIAG-01 規則2: 摘要不隨失敗筆數放大(同getMsgFail之上限)
        let rows = Array.from({ length: 12 }, (v, k) => ({ id: `${SECRET}-${k}` }))
        let so = WServOrm(DS, mkWOrm({ save: (d) => d.map(() => ({ n: 1, ok: 0, err: ERRTXT })) }), 'url', 'db')
        let cap = await capture(async () => {
            await getReject(so.procOrm('u1', 'tests', 'save', rows))
        })
        assert.strict.deepEqual(cap.calls, [['tests.save fail', { n: 12, ks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] }]])
    })

    it('O06 直接使用getMapOrm(未給設定)亦為安全輸出', async function() {
        //R-DIAG-01 規則1: 預設安全不依賴WServOrm; 第3參數為選用
        let woItems = { tests: mkWOrm({ save: (d) => d.map(() => ({ n: 1, ok: 0, err: ERRTXT })) })() }
        let mapOrm = getMapOrm(DS, woItems)
        let cap = await capture(async () => {
            assert.strict.equal(await getReject(mapOrm('u1', 'tests', 'save', ROWS())), `failed to save data: id[${SECRET}]`)
        })
        assert.strict.deepEqual(cap.calls, [['tests.save fail', { n: 1, ks: [0] }]])
        let mapOrm2 = getMapOrm(DS, woItems, { logDetail: true })
        let cap2 = await capture(async () => {
            await getReject(mapOrm2('u1', 'tests', 'save', ROWS()))
        })
        assert.strict.deepEqual(cap2.calls, [['tests.save fail', [{ k: 0, id: SECRET, err: ERRTXT }]]])
    })

    it('O07 摘要之錯誤類別與代碼只取白名單樣式, 不帶訊息文字', async function() {
        //R-DIAG-01 規則2: ORM錯誤物件的name與code若不是類別名稱與大寫代碼, 不列入; Proxy不被探測
        class MongoServerError extends Error {}
        let e1 = new MongoServerError(`${ERRTXT} ${SECRET}`)
        e1.code = 11000
        let e2 = new Error(ERRTXT)
        e2.name = SECRET //name不是類別名稱樣式
        e2.code = SECRET //code不是大寫代碼樣式
        let e3 = new Error(ERRTXT)
        e3.code = 'ERR_DUP_KEY'
        let trap = throwErr('trap')
        let e4 = new Proxy(new Error(ERRTXT), { get: trap, getOwnPropertyDescriptor: trap })
        let e5 = {
            message: `${ERRTXT} ${SECRET}`,
            get code() {
                throw new Error('getter')
            },
        }
        //外審 terra F04: 樣式合格不等於安全, 代碼只放行機器代碼樣式(ENOENT、ERR_xxx、SQLSTATE 5碼、小整數), 類別只取建構子名稱(name可被改)
        let mkCode = (c) => {
            let e = new Error(ERRTXT)
            e.code = c
            return e
        }
        let e6 = mkCode('ALICE123') //大寫的使用者識別
        let e7 = mkCode(987654321) //數字主鍵
        let e8 = mkCode('ENOENT')
        let e9 = mkCode('23505')
        let e10 = new Error(ERRTXT)
        e10.name = 'MongoServerError' //name被改, 不採用
        let e11 = mkCode('ALICE') //5碼大寫之使用者識別: 前2碼不是SQLSTATE已知類別(外審 terra R2-01)
        let e12 = mkCode('22P02') //SQLSTATE(類別22)
        let got = []
        //收到的摘要先轉為純資料再比對: 摘要若誤含原錯誤物件(Proxy、getter), 斷言失敗時格式化差異不得因此拋錯而掩蓋失敗
        let plain = (s) => {
            try {
                return JSON.parse(JSON.stringify(s))
            }
            catch (e) {
                return '(unserializable)'
            }
        }
        for (let e of [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12, 12345, null, undefined, Symbol('x')]) {
            let so = WServOrm(DS, mkWOrm({ raw: { save: () => Promise.reject(e) } }), 'url', 'db', { funLog: (label, safe) => got.push(plain(safe)) })
            await getReject(so.procOrm('u1', 'tests', 'save', ROWS()))
        }
        assert.strict.deepEqual(got, [
            { errType: 'MongoServerError', errCode: 11000 },
            { errType: 'Error' },
            { errType: 'Error', errCode: 'ERR_DUP_KEY' },
            { errType: 'Proxy' },
            { errType: 'object' },
            { errType: 'Error' },
            { errType: 'Error' },
            { errType: 'Error', errCode: 'ENOENT' },
            { errType: 'Error', errCode: '23505' },
            { errType: 'Error' },
            { errType: 'Error' },
            { errType: 'Error', errCode: '22P02' },
            { errType: 'number' },
            { errType: 'null' },
            { errType: 'undefined' },
            { errType: 'symbol' },
        ])
        assert.ok(!JSON.stringify(got).includes(SECRET) && !JSON.stringify(got).includes(ERRTXT))
    })

    it('O08 紀錄函式原地改動(遮罩、清空、追加)收到的摘要與細節: 全部路徑之reject值不變', async function() {
        //R-DIAG-01 規則4(外審 terra F08): 常見的原地遮罩logger不得改變reject訊息; 交出的是拷貝, 且reject訊息先於診斷輸出組出
        let scramble = (v, depth = 0) => {
            if (v === null || typeof v !== 'object' || depth > 6) {
                return
            }
            if (Array.isArray(v)) {
                for (let i = 0; i < v.length; i++) {
                    if (typeof v[i] === 'string') {
                        v[i] = '***'
                    }
                    else {
                        scramble(v[i], depth + 1)
                    }
                }
                v.push('***')
                return
            }
            for (let k of Object.keys(v)) {
                if (typeof v[k] === 'string') {
                    v[k] = '***'
                }
                else if (typeof v[k] === 'number') {
                    v[k] = -1
                }
                else {
                    scramble(v[k], depth + 1)
                }
            }
        }
        for (let p of PATHS) {
            let funLog = (label, safe, ...detail) => {
                scramble(safe)
                detail.forEach((d) => scramble(d))
            }
            let so = WServOrm(p.ds || DS, mkWOrm(p.plan), 'url', 'db', { funLog })
            let rej = await getReject(so.procOrm('u1', 'tests', p.mode, p.input(), p.opt))
            assert.strict.equal(rej, p.reject, p.id)
        }
    })

    it('O09 紀錄函式回傳帶throwing then getter之rejected promise、回傳thenable: 無未處理拒絕, reject值不變', async function() {
        //R-DIAG-01 規則4(外審 terra F09): 原生promise以內建then附處理(不讀可被覆寫之then屬性); 其他thenable只讀一次then並處理其回傳之promise
        let unhandled = []
        let h = (e) => {
            unhandled.push(e)
        }
        process.on('unhandledRejection', h)
        try {
            let p6 = PATHS.find((v) => v.id === 'P06')
            let withGetter = () => {
                let pr = Promise.reject(new Error('boom-getter'))
                Object.defineProperty(pr, 'then', {
                    get() {
                        throw new Error('then getter')
                    },
                })
                return pr
            }
            let thenable = () => ({
                then() {
                    return Promise.reject(new Error('boom-thenable'))
                },
            })
            for (let funLog of [withGetter, thenable]) {
                let so = WServOrm(DS, mkWOrm(p6.plan), 'url', 'db', { funLog })
                assert.strict.equal(await getReject(so.procOrm('u1', 'tests', 'save', ROWS())), p6.reject)
            }
            await new Promise((resolve) => setTimeout(resolve, 30))
        }
        finally {
            process.off('unhandledRejection', h)
        }
        assert.strict.deepEqual(unhandled, [])
    })

    it('O10 getDiag本身: 取細節拋錯以(unprintable)代替, console拋錯不外傳, bare只在logDetail時省略標籤', async function() {
        //R-DIAG-01 規則4: 診斷輸出不得使呼叫端拋錯(外審 terra F14: getDb舊版為console.log(err), 還原時不加標籤)
        let boom = () => {
            throw new Error('boom')
        }
        let cap = await capture(async () => {
            getDiag({ logDetail: true, funLog: null })('L', { s: 1 }, boom)
            getDiag({ logDetail: true, funLog: null })('L2', { s: 1 }, () => 'D', true)
            getDiag({ logDetail: false, funLog: null })('L3', { s: 1 }, () => 'D', true)
            getDiag({ logDetail: false, funLog: null })('L4')
            getDiag()('L5', { s: 5 })
        })
        assert.strict.deepEqual(cap.calls, [['L', '(unprintable)'], ['D'], ['L3', { s: 1 }], ['L4'], ['L5', { s: 5 }]])
        let got = []
        getDiag({ logDetail: false, funLog: (...a) => got.push(a) })('L', { s: 1 }, boom)
        assert.strict.deepEqual(got, [['L', { s: 1 }, '(unprintable)']])
        let logOrig = console.log
        console.log = () => {
            throw new Error('console boom')
        }
        try {
            getDiag({ logDetail: false, funLog: null })('L', { s: 1 })
            getDiag({ logDetail: true, funLog: null })('L', { s: 1 }, () => 'D')
        }
        finally {
            console.log = logOrig
        }
    })

    it('O11 adjustData之catch內e.toString()維持立即求值: 例外為null者仍reject failed to process input(同舊版), 三種設定相同', async function() {
        //R-DIAG-01 規則4(外審 terra F10): 舊版 console.log(…, e.toString()) 之引數立即求值, 拋出null者令toString拋TypeError而由邊界保證轉為 failed to process input; 診斷輸出不得改變
        let dsBad = { tests: { keys: { indexOf: throwNull } } }
        for (let [mode, input] of [['save', ROWS()], ['insert', ROWS()], ['mix', { add: ROWS() }], ['mix', { diff: ROWS() }]]) {
            for (let optWS of [undefined, { logDetail: true }, { funLog: () => {} }]) {
                let so = WServOrm(dsBad, mkWOrm({}), 'url', 'db', optWS)
                let cap = await capture(async () => {
                    assert.strict.equal(await getReject(so.procOrm('u1', 'tests', mode, input)), 'failed to process input', `${mode} ${JSON.stringify(optWS)}`)
                })
                assert.ok(!cap.text.includes(SECRET), cap.text)
            }
        }
    })

    it('O12 邊界catch之標籤只用固定mode與已驗證表名: mode為外部字串者標籤不回顯', async function() {
        //R-DIAG-01(外審 terra F06): 例外發生於mode驗證之前時, 外部傳入之mode字串不得進標籤
        let tab = {
            get keys() {
                throw new Error('boom')
            },
        }
        let dsGetter = { tests: tab }
        let labels = []
        let so = WServOrm(dsGetter, mkWOrm({}), 'url', 'db', { funLog: (label) => labels.push(label) })
        assert.strict.equal(await getReject(so.procOrm('u1', 'tests', SECRET, {})), 'failed to process input')
        assert.strict.equal(await getReject(so.procOrm('u1', 'tests', 'save', ROWS())), 'failed to process input')
        assert.strict.deepEqual(labels, ['tests. mapOrm catch', 'tests.save mapOrm catch'])
    })

    it('O13 getBriefResult: 不再讀取聚合物件之ok(getter前後不同者仍為{ok:0}), 不探測Proxy與陣列元素之getter', function() {
        //R-DIAG-01 規則2(外審 terra F07)
        let n = 0
        let agg = {
            get ok() {
                n++
                return n === 1 ? 0 : 987654321
            },
        }
        assert.strict.deepEqual(getBriefResult(agg), { ok: 0 })
        assert.strict.equal(n, 0, '摘要不讀ok')
        let traps = 0
        let px = new Proxy([{ ok: 0 }], {
            get() {
                traps++
                return undefined
            },
            getOwnPropertyDescriptor() {
                traps++
                return undefined
            },
        })
        assert.strict.deepEqual(getBriefResult(px), { type: 'Proxy' })
        let arr = [{ ok: 1 }, { ok: 0 }]
        Object.defineProperty(arr, 2, {
            get() {
                traps++
                return { ok: 0 }
            },
            enumerable: true,
        })
        assert.strict.deepEqual(getBriefResult(arr), { n: 1, ks: [1], skipped: 1 }) //索引存取器不執行, 以skipped標示摘要不完整(外審 terra R2-10)
        assert.strict.equal(traps, 0)
        let accEl = {}
        Object.defineProperty(accEl, 'ok', {
            get() {
                traps++
                return 0
            },
            enumerable: true,
        })
        let arr2 = [{ ok: 1 }, accEl]
        assert.strict.deepEqual(getBriefResult(arr2), { n: 0, ks: [], skipped: 1 }, 'ok為存取器之元素不執行, 標示skipped而非精確0')
        assert.strict.equal(traps, 0)
        //原型鏈上有Proxy之元素(外審 terra R3-06)
        let pxProto = new Proxy({ ok: 0 }, {
            get() {
                traps++
                return 0
            },
            getOwnPropertyDescriptor() {
                traps++
                return undefined
            },
            getPrototypeOf() {
                traps++
                return null
            },
        })
        let arr3 = [{ ok: 0 }, Object.create(pxProto)]
        assert.strict.deepEqual(getBriefResult(arr3), { n: 1, ks: [0], skipped: 1 })
        assert.strict.equal(traps, 0)
        let huge = new Array(2 ** 32 - 1)
        huge[0] = { ok: 0 }
        assert.strict.deepEqual(getBriefResult(huge), { n: 1, ks: [0], skipped: 2 ** 32 - 1 - 100000 })
        //空洞且陣列原型非標準: 該索引可能由原型提供, 標示skipped(外審 terra R4 之 R3-06 殘留)
        let withHole = [{ ok: 0 }, , { ok: 0 }] // eslint-disable-line no-sparse-arrays
        Object.setPrototypeOf(withHole, Object.create(Array.prototype, { 1: { value: { ok: 0 } } }))
        assert.strict.deepEqual(getBriefResult(withHole), { n: 2, ks: [0, 2], skipped: 1 })
        assert.strict.deepEqual(getBriefResult('x'), { type: 'string' })
        assert.strict.deepEqual(getBriefResult(null), { type: 'object' })
    })

    it('O14 建構選項只讀一次: getter前後不同者procOrm與recover共用同一快照', async function() {
        //R-DIAG-01(外審 terra F12): WServOrm讀一次opt, 交固定快照給getMapOrm與getWoItems
        let n = 0
        let got = []
        let logger = (...a) => got.push(a)
        let opt = {
            get funLog() {
                n++
                return n === 1 ? logger : null
            },
        }
        let p6 = PATHS.find((v) => v.id === 'P06')
        let so = WServOrm(DS, mkWOrm(p6.plan), 'url', 'db', opt)
        assert.strict.equal(n, 1)
        let cap = await capture(async () => {
            assert.strict.equal(await getReject(so.procOrm('u1', 'tests', 'save', ROWS())), p6.reject)
        })
        assert.strict.deepEqual(cap.calls, [])
        assert.strict.equal(got.length, 1)
        assert.strict.equal(n, 1)
    })

    it('O14b 建構選項快照亦用於實例上之backup與recover: getter前後不同者仍全部走同一紀錄函式', async function() {
        //R-DIAG-01(外審 terra R2-06、R2-12)
        let n = 0
        let got = []
        let logger = (...a) => got.push(a[0])
        let opt = {
            get funLog() {
                n++
                return n === 1 ? logger : null
            },
        }
        let so = WServOrm(DS, mkWOrm({}), 'url', 'db', opt)
        let cap = await capture(async () => {
            await getReject(so.recover(path.resolve('./test/_tmp/none.json'), { tests: {} }))
            await getReject(so.backup(SECRET))
        })
        assert.strict.deepEqual(cap.calls, [])
        assert.strict.deepEqual(got, ['fp', 'woItems'])
        assert.strict.equal(n, 1)
    })

    it('O14c getOptLogLoose: 單一選項之getter拋錯只丟該選項, 不連累另一個有效選項', function() {
        //R-DIAG-01(外審 terra R2-06)
        let logger = () => {}
        let a = {
            funLog: logger,
            get logDetail() {
                throw new Error('boom')
            },
        }
        assert.strict.deepEqual(getOptLogLoose(a), { logDetail: false, funLog: logger })
        let b = {
            logDetail: true,
            get funLog() {
                throw new Error('boom')
            },
        }
        assert.strict.deepEqual(getOptLogLoose(b), { logDetail: true, funLog: null })
        assert.strict.deepEqual(getOptLogLoose(undefined), { logDetail: false, funLog: null })
        assert.strict.deepEqual(getOptLogLoose({ logDetail: 'true', funLog: 'x' }), { logDetail: false, funLog: null })
    })

    it('O14d cpDetail: 深層拷貝(巢狀物件與陣列互不共用), 原生Error保留原型與自有資料屬性, 不執行getter, Proxy與其他物件原樣, 超過上限者原樣', function() {
        //R-DIAG-01 規則4(外審 terra R2-03、R2-04、R2-15): 交給funLog的細節與其後仍要使用的物件隔離
        let inner = { deep: { x: 1 }, arr: [{ y: 2 }] }
        let c = cpDetail({ a: inner, list: [inner] })
        c.a.deep.x = 9
        c.list[0].arr[0].y = 9
        assert.strict.equal(inner.deep.x, 1)
        assert.strict.equal(inner.arr[0].y, 2)
        class MongoServerError extends Error {}
        let e = new MongoServerError('orig')
        e.code = 11000
        e.nested = { k: 1 }
        let ce = cpDetail(e)
        assert.ok(ce instanceof MongoServerError && ce !== e)
        assert.strict.equal(ce.message, 'orig')
        assert.strict.equal(ce.code, 11000)
        assert.ok(typeof ce.stack === 'string' && ce.stack.includes('orig') && ce.stack !== '[Getter/Setter]')
        ce.message = 'masked'
        ce.nested.k = 2
        delete ce.code
        assert.strict.equal(e.message, 'orig')
        assert.strict.equal(e.nested.k, 1)
        assert.strict.equal(e.code, 11000)
        let n = 0
        let withGetter = {
            get g() {
                n++
                return 1
            },
            v: 1,
        }
        let cg = cpDetail(withGetter)
        assert.strict.deepEqual(Object.keys(cg), ['g', 'v'])
        assert.strict.equal(cg.g, '[Getter/Setter]', '存取器不執行, 以標記保留其鍵')
        assert.strict.equal(n, 0)
        let px = new Proxy({}, {})
        assert.strict.equal(cpDetail(px), '[Proxy]') //不交出原參照
        let proto = JSON.parse('{"__proto__":1,"id":"a"}')
        let cp = cpDetail(proto)
        assert.strict.equal(Object.getPrototypeOf(cp), Object.prototype)
        assert.strict.equal(Object.keys(cp).length, 2)
        //循環不致無窮遞迴(深度上限), 超過深度者為標記字串而非原參照
        let loop = { a: 1 }
        loop.self = loop
        let cl = cpDetail(loop)
        assert.strict.equal(cl.self.self.self.self.self.self.self.self, '[Truncated]')
        assert.strict.equal(cpDetail('str'), 'str')
        assert.strict.equal(cpDetail(null), null)
    })

    it('O14e cpDetail: Date不經實例方法、Error的stack只在內建getter時讀取、Buffer與Map與Set與類別實例皆獨立複本(外審 terra R3-01、R3-02)', function() {
        //R-DIAG-01 規則4: 複製過程不得執行使用端程式, 亦不得與原物件共用可變內容
        let calls = 0
        let d = new Date(5)
        d.getTime = () => {
            calls++
            return 99
        }
        let cd = cpDetail(d)
        assert.strict.equal(calls, 0)
        assert.strict.equal(Date.prototype.getTime.call(cd), 5)
        let e = new Error('original')
        //看似內建之getter: Function.prototype.toString 對bound函數呈現 [native code] 字樣
        let userGetter = function() {
            e.message = 'changed'
            return this === null ? 'stack' : 'stack'
        }
        Object.defineProperty(e, 'stack', {
            get: userGetter.bind(null),
            configurable: true,
        })
        let ce = cpDetail(e)
        assert.strict.equal(e.message, 'original', '使用端定義之stack getter(含看似原生之bound函數)不被執行')
        assert.strict.equal(ce.stack, '[Getter/Setter]', '非內建getter之stack不執行, 以標記保留其鍵')
        let e2 = new Error('x')
        e2.extra = Buffer.from([65, 66])
        e2.map = new Map([['k', { v: 1 }]])
        e2.map.reason = 'map own prop'
        e2.set = new Set([{ s: 1 }])
        e2.set.reason = 'set own prop'
        e2.date = new Date(7)
        e2.date.reason = 'date own prop'
        class Box {
            constructor() {
                this.items = [1, 2]
            }
        }
        e2.box = new Box()
        let c2 = cpDetail(e2)
        c2.map.get('k').v = 2
        let firstS = [...c2.set][0]
        firstS.s = 2
        c2.box.items.push(3)
        assert.strict.equal(e2.map.get('k').v, 1)
        assert.strict.equal([...e2.set][0].s, 1)
        assert.strict.deepEqual(e2.box.items, [1, 2])
        assert.ok(c2.box instanceof Box && c2.map instanceof Map && c2.set instanceof Set && c2.date instanceof Date)
        assert.strict.equal(c2.map.reason, 'map own prop', 'Map之自有資料屬性保留(外審 terra R4-06)')
        assert.strict.equal(c2.set.reason, 'set own prop')
        assert.strict.equal(c2.date.reason, 'date own prop')
        assert.ok(typeof c2.stack === 'string' && c2.stack.startsWith('Error: x\n'), '內建getter的stack仍複製(還原舊輸出含堆疊), 非標記字串')
        //二進位資料一律標記, 不經structuredClone: Buffer不再與原資料共用、不變為Uint8Array、小視圖不牽動巨大底層緩衝區、共享記憶體不複製(外審 terra R4-03、R4-04、R4-05)
        assert.strict.equal(c2.extra, '[Binary 2 bytes]')
        assert.strict.equal(cpDetail(new Uint8Array(new ArrayBuffer(1024 ** 3), 0, 1)), '[Binary 1 bytes]')
        assert.strict.equal(cpDetail(new Uint8Array(new SharedArrayBuffer(8))), '[Binary 8 bytes]')
        assert.strict.equal(cpDetail(new DataView(new ArrayBuffer(4))), '[Binary 4 bytes]')
        assert.strict.equal(cpDetail(new ArrayBuffer(3)), '[Binary 3 bytes]')
        assert.strict.equal(cpDetail(new SharedArrayBuffer(8)), '[SharedArrayBuffer]')
        //RegExp不執行其自有getter(外審 terra R4-02); 函數、Promise標記
        let rx = /a/
        let hit = 0
        Object.defineProperty(rx, 'source', {
            get() {
                hit++
                return 'a'
            },
        })
        assert.strict.equal(cpDetail(rx), '[RegExp]')
        assert.strict.equal(hit, 0)
        assert.strict.equal(cpDetail(() => 1), '[Function]')
        assert.strict.equal(cpDetail(Promise.resolve(1)), '[Object]')
    })

    it('O14f cpDetail: 寬陣列、稀疏陣列、大物件之處理量有上限; 陣列自有非索引鍵保留; 空洞與長度保留', function() {
        //R-DIAG-01(外審 terra R3-03、R3-04): 診斷不得因細節巨大而卡住或耗盡記憶體
        //[P6 效能時限] 處理量有界: 以CPU時間斷言, 裕度5000 CPU毫秒(見test/tools/cpuBound.mjs)
        let { r: [sparse, wide, detailObj], cpu } = cpuMsSync(() => {
            let sparse = cpDetail(new Array(2 ** 32 - 1))
            let wide = cpDetail(new Array(300000).fill(1))
            let obj = {}
            for (let i = 0; i < 20000; i++) {
                obj[`k${i}`] = i
            }
            return [sparse, wide, cpDetail(obj)]
        }, 'O14f cpDetail')
        assert.strict.equal(sparse.length, 2 ** 32 - 1)
        assert.ok(Object.keys(wide).length <= 5000, `${Object.keys(wide).length}`)
        assert.ok(Object.keys(detailObj).length <= 5000)
        assert.ok(cpu < 5000, `耗時有界, CPU耗時 ${cpu} ms`)
        let arr = [1, , 3] // eslint-disable-line no-sparse-arrays
        arr.reason = 'driver failure'
        let sym = Symbol('s')
        arr[sym] = 's'
        let ca = cpDetail(arr)
        assert.strict.equal(ca.length, 3)
        assert.ok(!(1 in ca), '空洞保留')
        assert.strict.equal(ca.reason, 'driver failure')
        assert.strict.equal(ca[sym], 's')
    })

    it('O15 實例上backup、recover之函數型態與參數個數同原函數(AsyncFunction; length 1與3)', function() {
        //R-DIAG-01(外審 terra F16): 為帶入本實例之診斷設定而包裝, 型態與length不變; 各實例之函數身分不同
        let A = WServOrm(DS, mkWOrm({}), 'url', 'db')
        let B = WServOrm(DS, mkWOrm({}), 'url', 'db')
        assert.strict.equal(A.backup.length, 1)
        assert.strict.equal(A.recover.length, 3)
        assert.strict.equal(A.backup.constructor.name, 'AsyncFunction')
        assert.strict.equal(A.recover.constructor.name, 'AsyncFunction')
        assert.ok(A.recover !== B.recover)
    })

    it('O16 getMapOrm直接使用且ds無效: 輸出ds型別與adjustData錯誤類別, 不含ds值', async function() {
        //R-DIAG-01: adjustData內無效ds亦經diag(外審 terra F01)
        let woItems = { tests: mkWOrm({})() }
        let mapOrm = getMapOrm({}, woItems)
        let cap = await capture(async () => {
            assert.strict.equal(await getReject(mapOrm('u1', 'tests', 'save', ROWS())), 'failed to adjust data')
        })
        assert.strict.deepEqual(cap.calls, [['ds', { type: 'object' }], ['tests.adjustData catch', { errType: 'Error' }]])
    })

})


describe('console診斷輸出站點盤點(R-DIAG-01)', function() {

    //新不變式(外審 terra F01、F02、F03、F18後): src內除 getDiag.mjs 之 diag 外, 任何檔不得直接輸出(console、process.stdout/stderr、fs.writeSync到1或2、emitWarning、util.debuglog),
    //包含無效參數、進度、完成訊息與錯誤, 一律經 diag 使 funLog 能接管且預設輸出不含呼叫端傳入之值; 新增直接輸出者須先於帳本歸類並更新此表
    function stripComment(line) {
        let t = line.trim()
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) {
            return ''
        }
        //行內註解: 只在引號與反引號之外的 // 才截斷(字串內的 // 不是註解, 外審 terra R3-07)
        let q = null
        for (let i = 0; i < line.length; i++) {
            let c = line[i]
            if (q !== null) {
                if (c === '\\') {
                    i++
                }
                else if (c === q) {
                    q = null
                }
                continue
            }
            if (c === '\'' || c === '"' || c === '`') {
                q = c
            }
            else if (c === '/' && line[i + 1] === '/') {
                return line.slice(0, i)
            }
        }
        return line
    }

    function scan(re) {
        let fd = path.resolve('./src')
        let out = {}
        for (let f of fs.readdirSync(fd).filter((v) => v.endsWith('.mjs')).sort()) {
            let txt = fs.readFileSync(path.join(fd, f), 'utf8').split(/\r?\n/).map(stripComment).join('\n')
            let n = [...txt.matchAll(re)].length
            if (n > 0) {
                out[f] = n
            }
        }
        return out
    }

    it('S01 src內console之出現: 只在getDiag.mjs(diag本體之4處), 其餘檔皆無(含別名、方括號記法)', function() {
        //R-DIAG-01 規則5: 以識別字console計(涵蓋 console.log、console['log']、const c = console 等)
        assert.strict.deepEqual(scan(/\bconsole\b/g), { 'getDiag.mjs': 4 })
    })

    it('S02 src內無其他輸出途徑: process、globalThis、global之屬性存取、stdout/stderr、writeSync、emitWarning、debuglog、動態require與import', function() {
        //R-DIAG-01 規則5(外審 terra F18、R2-11): 禁止以 globalThis['process']['std'+'err'] 之類字串拼接繞過識別字掃描, 故連 process 與 globalThis 之屬性存取一併禁止
        let re = /\bprocess\s*[.[]|\bglobalThis\b|\bglobal\s*[.[]|\bstd(out|err)\b|\bwriteSync\s*\(|\bemitWarning\b|\bdebuglog\b|\bdebug\s*\(|\brequire\s*\(|\bimport\s*\(|\bFunction\s*\(|\beval\s*\(/g
        assert.strict.deepEqual(scan(re), {})
    })

    //診斷呼叫(diag)之摘要(第2引數)的語法白名單: 摘要只能是下列固定形式(不含主鍵、資料值、錯誤原文、傳入參數值); 新增形式須先審並加入此表
    //表名(k、v.name)取自 woItems 之自有鍵, 即資料表名(任務明列可輸出表名)
    //依檔綁定(外審 terra R3-07): 同一形式在其他檔不得使用,如 getSettings 不得以 k 當摘要
    let SAFE_ARGS = {
        'genTestData.mjs': ['{ n: getBriefCount(rs) }'],
        'getDb.mjs': ['(none)', 'getBriefErr(err)', '{ n: size(tabs), tables: keys(tabs) }'],
        'getDbBackupAndRecover.mjs': ['(none)', 'getBriefType(woItems)', 'getBriefType(fp)', 'getBriefResult(r)', 'k', 'v.name'],
        'getMapOrm.mjs': [
            '(none)',
            'getBriefErr(msg)',
            'getBriefErr(e)',
            'getBriefFails(fails)',
            'getBriefFails(failsNotObj)',
            'getBriefFails(failsIdXSS)',
            'getBriefFails(failsDup)',
            'getBriefFails(failsIrregularId)',
            'getBriefResult(r)',
            'getBriefResult(rs)',
            'getBriefResult(rsAdd)',
            'getBriefType(ds)',
            '[...msgsBadKey]',
            '[...msgsSameId]',
            '{ reason: errFind }',
        ],
        'getSettings.mjs': ['{ keys: ks.filter((v) => KEYS_KNOWN.indexOf(v) >= 0), nOther: ks.filter((v) => KEYS_KNOWN.indexOf(v) < 0).length }', 'getBriefErr(err)'],
        'getWoItems.mjs': ['getBriefType(ds)', 'getBriefType(WOrm)', 'getBriefType(url)', 'getBriefType(db)'],
    }
    //各檔 diag 呼叫數(新增站點須先歸類並更新): 2026-10-28 共66處
    let SITE_COUNTS = { 'genTestData.mjs': 2, 'getDb.mjs': 8, 'getDbBackupAndRecover.mjs': 7, 'getMapOrm.mjs': 43, 'getSettings.mjs': 2, 'getWoItems.mjs': 4 }

    function splitTop(s) {
        //依最外層逗號切分引數(忽略括號、中括號、大括號、字串與反引號模板內)
        let args = []
        let cur = ''
        let depth = 0
        let tpl = false
        let q = null
        for (let i = 0; i < s.length; i++) {
            let c = s[i]
            if (q !== null || tpl) {
                cur += c
                if (q !== null && c === q && s[i - 1] !== '\\') {
                    q = null
                }
                if (tpl && c === '`' && s[i - 1] !== '\\') {
                    tpl = false
                }
                continue
            }
            if (c === '`') {
                tpl = true
            }
            else if (c === '\'' || c === '"') {
                q = c
            }
            else if ('([{'.includes(c)) {
                depth++
            }
            else if (')]}'.includes(c)) {
                depth--
            }
            else if (c === ',' && depth === 0) {
                args.push(cur.trim())
                cur = ''
                continue
            }
            cur += c
        }
        args.push(cur.trim())
        return args
    }

    function scanCalls(txt) {
        //取出每個 diag( 呼叫之引數
        let out = []
        let re = /(?<![\w.])diag\(/g
        let m
        while ((m = re.exec(txt)) !== null) {
            let i = m.index + m[0].length
            let depth = 1
            let tpl = false
            let q = null
            let j = i
            for (; j < txt.length && depth > 0; j++) {
                let c = txt[j]
                if (q !== null) {
                    if (c === q && txt[j - 1] !== '\\') {
                        q = null
                    }
                }
                else if (tpl) {
                    if (c === '`' && txt[j - 1] !== '\\') {
                        tpl = false
                    }
                }
                else if (c === '`') {
                    tpl = true
                }
                else if (c === '\'' || c === '"') {
                    q = c
                }
                else if (c === '(') {
                    depth++
                }
                else if (c === ')') {
                    depth--
                }
            }
            out.push(splitTop(txt.slice(i, j - 1)))
        }
        return out
    }

    it('S04 src內每個 diag 呼叫之摘要引數皆在語法白名單內, 且各檔站點數同已歸類之表', function() {
        //R-DIAG-01 規則5(外審 terra R2-12): 以站點而非標籤集合鎖定; 例如在既有標籤的站點加印輸入(diag(標籤, input))會因摘要引數不在白名單而失敗
        let fd = path.resolve('./src')
        let counts = {}
        let bad = []
        for (let f of fs.readdirSync(fd).filter((v) => v.endsWith('.mjs') && v !== 'getDiag.mjs').sort()) {
            let txt = fs.readFileSync(path.join(fd, f), 'utf8').split(/\r?\n/).map(stripComment).join('\n')
            let cs = scanCalls(txt)
            if (cs.length > 0) {
                counts[f] = cs.length
            }
            for (let a of cs) {
                let safe = a.length < 2 ? '(none)' : a[1].replace(/\s+/g, ' ')
                if (!(SAFE_ARGS[f] || []).includes(safe)) {
                    bad.push(`${f}: ${a[0]} -> ${safe}`)
                }
            }
        }
        assert.strict.deepEqual(bad, [])
        assert.strict.deepEqual(counts, SITE_COUNTS)
    })

    it('S05 getDiag.mjs以外之檔不得 import 後直接輸出: logFind之診斷亦只經 diag', function() {
        //R-DIAG-01: logFind 內之 diag 摘要為 { reason: errFind }(S04 已涵蓋); 此案確認 logFind 之呼叫皆傳 diag 與 errFind
        let txt = fs.readFileSync(path.resolve('./src/getMapOrm.mjs'), 'utf8').split(/\r?\n/).map(stripComment).join('\n')
        let calls = [...txt.matchAll(/\blogFind\(([^)]*)\)/g)].map((m) => m[1])
        assert.strict.equal(calls.length, 3) //定義1 + select、delAll各1
        for (let c of calls.slice(1)) {
            assert.ok(/^diag, `\$\{woName\}\.\w+ invalid find`, errFind, input$/.test(c), c)
        }
    })

    it('S03 getMapOrm.mjs之每個診斷標籤皆有路徑表(PATHS)之案例涵蓋', function() {
        //R-DIAG-01(外審 terra F17): 站點與案例機械比對, 新增站點而無案例即失敗; ${mode}展開為insert、save, ${key}展開為add、diff
        let fd = path.resolve('./src/getMapOrm.mjs')
        let txt = fs.readFileSync(fd, 'utf8').split(/\r?\n/).map(stripComment).join('\n')
        let rests = new Set()
        let tokMode = '$' + '{mode}' //原始碼中模板字串之佔位字樣
        let tokKey = '$' + '{key}'
        for (let m of txt.matchAll(/(?:\bdiag\(|\blogFind\(diag, )`\$\{woName\}\.([^`]+)`/g)) {
            let r = m[1]
            let ms = r.includes(tokMode) ? ['insert', 'save'] : [null]
            for (let mode of ms) {
                let ks = r.includes(tokKey) ? ['add', 'diff'] : [null]
                for (let key of ks) {
                    let s = r
                    if (mode !== null) {
                        s = s.split(tokMode).join(mode)
                    }
                    if (key !== null) {
                        s = s.split(tokKey).join(key)
                    }
                    rests.add(`tests.${s}`)
                }
            }
        }
        rests.add('tests.save mapOrm catch') //邊界catch之標籤以表達式組成, 不在上述正則內
        assert.ok(rests.size >= 35, `標籤數 ${rests.size}`) //正則確實取到站點(2026-10-28 為37種標籤)
        let covered = new Set(PATHS.map((v) => v.label))
        let missing = [...rests].filter((v) => !covered.has(v))
        assert.strict.deepEqual(missing, [])
    })

})
