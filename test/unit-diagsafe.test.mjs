import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import assert from 'assert'
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
import * as briefMod from '../src/getDiagBrief.mjs'
import { SAFE_KEYS } from '../src/safeKeys.mjs'
import WServOrm from '../src/WServOrm.mjs'
import getDb from '../src/getDb.mjs'
import getSettings from '../src/getSettings.mjs'
import { takeSeen } from './tools/diagSpy.mjs'


//R-DIAG-02(2026-10-30, 排程第187、192項; 規格 C:\opensrcOper\dspec\診斷輸出與遮罩.md D1): 本檔驗三件事
//  A. SAFE_KEYS公開入口(src/safeKeys.mjs): 下游(w-web-sso、w-web-api、w-web-task、w-web-perm)以 genDiagFunLog(write, { safeKeys }) 引用之單一來源, 不得再深層匯入內部檔
//  B. SAFE_KEYS與本套件funLog「實際產出」之鍵一致(不手寫第二份清單): 把src複製到test/_tmp, 換入記錄替身(tools/diagSpy.mjs)取得各站點過濾前之safe, 與SAFE_KEYS雙向比對;
//     並以genDiagFunLog(write, { safeKeys: SAFE_KEYS })照下游用法轉寫, 逐站與原始值一致(第二道防線不丟本套件產出之鍵)
//  C. 靜態: src不匯入wsemi底線內部檔(_diagKit.mjs等); getUrlSecrets已刪除, 秘密改由 getDiagSecrets({ conns: [url] }) 導出(連線字串與儲存路徑之分類同舊行為, 接線案見unit-diaglog-wire之U22)
//  各案註解標明對應之需求句: R1=公開SAFE_KEYS(下游單一來源); R2=內容與funLog實際產出一致; R3=不匯入wsemi內部檔; R4=getUrlSecrets刪除且分類行為不變; R5=README寫明用途與用法


let fd = path.resolve('./test/_tmp/unit-diagsafe')
let fdSrc = path.join(fd, 'src')
let DS = { tests: { keys: ['id', 'name'] } }

//errType、errCode由wsemi恆含, 不列於SAFE_KEYS
let ALWAYS = ['errType', 'errCode']


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

function mkWOrm(plan = {}) {
    return function() {
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

//diffKeys, 生產端實際產出之鍵(raw, 已去除恆含者)對宣告之鍵(declared)的雙向差異: missing為產出而未宣告, extra為宣告而從未產出
function diffKeys(raw, declared) {
    let r = new Set(raw)
    let d = new Set(declared)
    return {
        missing: [...r].filter((k) => !d.has(k)).sort(),
        extra: [...d].filter((k) => !r.has(k)).sort(),
    }
}

//src之匯入敘述(from '...' 與 import '...'), 去除整行註解
function importsOf(file) {
    let code = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    return [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] || m[2] || m[3])
}


//情境集: 每個情境經真實呼叫點執行, funLog由呼叫端給(spy模式給空函數, 下游模式給genDiagFunLog之funLog)
//keys為該情境應產出之(非恆含)鍵, 供確認情境確實跑到對應站點(情境失效時由第一個測試判紅, 不會靜默少覆蓋)
let SCENES = [
    {
        id: 'S1 save逐筆失敗',
        keys: ['n', 'ks'],
        run: async (m, funLog) => {
            let so = m.WServOrm(DS, mkWOrm({ save: (d) => d.map(() => ({ n: 1, ok: 0 })) }), 'url', 'db', { funLog })
            await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a', name: 'x' }]))
        },
    },
    {
        id: 'S2 insert聚合物件ok為0',
        keys: ['ok'],
        run: async (m, funLog) => {
            let so = m.WServOrm(DS, mkWOrm({ insert: () => ({ n: 1, ok: 0 }) }), 'url', 'db', { funLog })
            await getReject(so.procOrm('u1', 'tests', 'insert', [{ id: 'a', name: 'x' }]))
        },
    },
    {
        id: 'S3 insert逐筆陣列含存取器索引',
        keys: ['n', 'ks', 'skipped'],
        run: async (m, funLog) => {
            let arr = [{ n: 1, ok: 0 }, null]
            Object.defineProperty(arr, 1, { get: () => ({ ok: 0 }), enumerable: true })
            let so = m.WServOrm(DS, mkWOrm({ insert: () => arr }), 'url', 'db', { funLog })
            await getReject(so.procOrm('u1', 'tests', 'insert', [{ id: 'a', name: 'x' }]))
        },
    },
    {
        id: 'S4 無效ds',
        keys: ['type'],
        run: async (m, funLog) => {
            getThrow(() => m.WServOrm(123, mkWOrm(), 'url', 'db', { funLog }))
        },
    },
    {
        id: 'S5 被拒的find',
        keys: ['reason'],
        run: async (m, funLog) => {
            let so = m.WServOrm(DS, mkWOrm(), 'url', 'db', { funLog })
            await getReject(so.procOrm('u1', 'tests', 'select', JSON.parse('{"__proto__":1,"id":"a"}')))
        },
    },
    {
        id: 'S6 列含自有__proto__鍵',
        keys: ['msgs'],
        run: async (m, funLog) => {
            let so = m.WServOrm(DS, mkWOrm(), 'url', 'db', { funLog })
            await getReject(so.procOrm('u1', 'tests', 'insert', [JSON.parse('{"__proto__":1,"id":"a"}')]))
        },
    },
    {
        id: 'S7 getDb.recover(bRela)傾印與進度',
        keys: ['n', 'tables', 'table'],
        run: async (m, funLog) => {
            let ds = { tests: { keys: ['id'], settings: { id: { pk: true, type: 'STRING' } } } }
            let woItems = { tests: { select: async () => [], insert: async (d) => ({ n: d.length, ok: 1 }), createStorage: async () => 'created' } }
            await m.getDb.recover(woItems, path.join(fd, 'bk-rela.json'), { bRela: true, ds, genModelsByTabs: () => {}, fdModels: path.join(fd, 'models'), funLog })
        },
    },
    {
        id: 'S8 getSettings設定檔無效',
        keys: ['keys', 'nOther'],
        run: async (m, funLog) => {
            getThrow(() => m.getSettings({ fn: path.join(fd, 'settings-bad.json'), funLog }))
        },
    },
    {
        id: 'S9 ORM reject(只有errType)',
        keys: [],
        run: async (m, funLog) => {
            let so = m.WServOrm(DS, mkWOrm({ save: () => Promise.reject(new Error('x')) }), 'url', 'db', { funLog })
            await getReject(so.procOrm('u1', 'tests', 'save', [{ id: 'a', name: 'x' }]))
        },
    },
]


describe('unit-diagsafe(R-DIAG-02 SAFE_KEYS公開入口)', function() {

    let spyMods = null

    before(async function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fdSrc, { recursive: true })
        fs.writeFileSync(path.join(fd, 'bk-rela.json'), JSON.stringify([{ name: 'tests', data: [{ id: 'a' }] }]), 'utf8')
        fs.writeFileSync(path.join(fd, 'settings-bad.json'), JSON.stringify({ dbType: 'mongodb', dbUsername: 'u', dbPassword: 'p', k1: 1 }), 'utf8') //缺dbName: 讀取失敗並傾印已知鍵與未知鍵數

        //複製src, 僅把getDiagBrief.mjs對wsemi getDiag之匯入換為記錄替身(其餘位元組相同)
        let ft = path.resolve('./src')
        for (let f of fs.readdirSync(ft).filter((v) => v.endsWith('.mjs'))) {
            let code = fs.readFileSync(path.join(ft, f), 'utf8')
            if (f === 'getDiagBrief.mjs') {
                let from = 'import getDiag from \'wsemi/src/getDiag.mjs\''
                assert.strictEqual(code.split(from).length, 2, 'getDiagBrief.mjs須恰有一處getDiag匯入')
                code = code.replace(from, 'import getDiag from \'../../../tools/diagSpy.mjs\'')
            }
            fs.writeFileSync(path.join(fdSrc, f), code, 'utf8')
        }
        let load = async (f) => (await import(pathToFileURL(path.join(fdSrc, f)).href)).default
        spyMods = {
            WServOrm: await load('WServOrm.mjs'),
            getDb: await load('getDb.mjs'),
            getSettings: await load('getSettings.mjs'),
        }
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })


    describe('A. 公開入口 src/safeKeys.mjs', function() {

        it('A1 SAFE_KEYS為凍結之字串陣列, 無重複, 不含憑證鍵名, 不列恆含之errType與errCode (R1)', function() {
            assert.ok(Array.isArray(SAFE_KEYS) && SAFE_KEYS.length > 0)
            assert.ok(Object.isFrozen(SAFE_KEYS), '凍結: 下游無法改動單一來源')
            assert.throws(() => SAFE_KEYS.push('x'), TypeError)
            assert.strictEqual(new Set(SAFE_KEYS).size, SAFE_KEYS.length, '無重複')
            for (let k of SAFE_KEYS) {
                assert.strictEqual(typeof k, 'string', k)
                assert.ok(k !== '' && !ALWAYS.includes(k), k)
                assert.ok(!/password|passwd|pwd|secret|token|authorization|api[_-]?key|x-api-key|__sysToken__/i.test(k), `憑證鍵名不得列入: ${k}`)
            }
        })

        it('A2 safeKeys.mjs零import(下游以深層匯入, 不帶入其他內部檔), 只匯出SAFE_KEYS (R1)', async function() {
            assert.deepStrictEqual(importsOf(path.resolve('./src/safeKeys.mjs')), [])
            let ns = await import(pathToFileURL(path.resolve('./src/safeKeys.mjs')).href)
            assert.deepStrictEqual(Object.keys(ns), ['SAFE_KEYS'])
            assert.strictEqual(ns.SAFE_KEYS, SAFE_KEYS)
        })

        it('A3 單一來源: getDiagBrief.mjs自safeKeys.mjs取SAFE_KEYS並交給getDiag, 全src無第二份宣告 (R1)', function() {
            let fts = path.resolve('./src')
            let all = fs.readdirSync(fts).filter((v) => v.endsWith('.mjs'))
            assert.ok(importsOf(path.join(fts, 'getDiagBrief.mjs')).includes('./safeKeys.mjs'))
            for (let f of all) {
                let code = fs.readFileSync(path.join(fts, f), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
                let nDecl = (code.match(/\b(?:const|let|var)\s+SAFE_KEYS\b/g) || []).length
                assert.strictEqual(nDecl, f === 'safeKeys.mjs' ? 1 : 0, `${f}: SAFE_KEYS宣告數`)
                if (f !== 'safeKeys.mjs' && f !== 'getDiagBrief.mjs') {
                    assert.ok(!/\bSAFE_KEYS\b|\bsafeKeys\b/.test(code), `${f}: 只有getDiagBrief.mjs可引用`)
                }
            }
            assert.strictEqual((fs.readFileSync(path.join(fts, 'getDiagBrief.mjs'), 'utf8').match(/safeKeys: SAFE_KEYS/g) || []).length, 1)
        })

        it('A4 README之下游匯入寫法與實際模組相符: 所寫之路徑存在且匯出SAFE_KEYS (R5)', async function() {
            let md = fs.readFileSync(path.resolve('./README.md'), 'utf8')
            let m = md.match(/import \{ SAFE_KEYS \} from '(w-serv-orm\/[^']+)'/)
            assert.ok(m !== null, 'README須有 import { SAFE_KEYS } from \'w-serv-orm/...\' 之寫法')
            let fn = path.resolve('.', m[1].replace(/^w-serv-orm\//, ''))
            assert.ok(fs.existsSync(fn), fn)
            let ns = await import(pathToFileURL(fn).href)
            assert.strictEqual(ns.SAFE_KEYS, SAFE_KEYS)
            assert.ok(/genDiagFunLog\([^)]*safeKeys: SAFE_KEYS/.test(md), 'README須寫明搭配genDiagFunLog之用法')
        })

    })


    describe('B. SAFE_KEYS與funLog實際產出之鍵一致', function() {

        it('B1 各情境確實跑到對應站點(情境失效不致靜默少覆蓋) (R2)', async function() {
            for (let s of SCENES) {
                takeSeen()
                await s.run(spyMods, () => {})
                let got = new Set()
                takeSeen().forEach((e) => e.safe !== null && Object.keys(e.safe).forEach((k) => got.add(k)))
                for (let k of s.keys) {
                    assert.ok(got.has(k), `${s.id}: 應產出[${k}], 實得[${[...got]}]`)
                }
            }
        })

        it('B2 站點過濾前之safe鍵(去除恆含者)與SAFE_KEYS雙向一致: 無漏列、無從未產出之鍵 (R2)', async function() {
            let raw = new Set()
            for (let s of SCENES) {
                takeSeen()
                await s.run(spyMods, () => {})
                takeSeen().forEach((e) => e.safe !== null && Object.keys(e.safe).filter((k) => !ALWAYS.includes(k)).forEach((k) => raw.add(k)))
            }
            assert.deepStrictEqual(diffKeys(raw, SAFE_KEYS), { missing: [], extra: [] }, `產出[${[...raw].sort()}]宣告[${[...SAFE_KEYS].sort()}]`)
        })

        it('B3 下游用法: 以genDiagFunLog(write, { safeKeys: SAFE_KEYS })轉寫, 逐站之safe與生產端原始值相同(不丟鍵), 且不取細節 (R1、R2)', async function() {
            let nStation = 0
            for (let s of SCENES) {
                //生產端: 真實src經真實getDiag(已依SAFE_KEYS過濾), 下游: 同一funLog再經genDiagFunLog之safeKeys; 原始值取自記錄替身(未過濾)
                takeSeen()
                await s.run(spyMods, () => {})
                let raws = takeSeen().filter((e) => e.safe !== null)

                let rs = []
                let { funLog } = genDiagFunLog((o) => rs.push(o), { safeKeys: SAFE_KEYS })
                await s.run({ WServOrm, getDb, getSettings }, funLog)
                let written = rs.filter((o) => o.safe !== undefined && Object.keys(o.safe).length > 0)

                assert.deepStrictEqual(rs.map((o) => Object.keys(o).sort()), rs.map(() => ['event', 'label', 'safe']), `${s.id}: write只收{ event, label, safe }`)
                assert.deepStrictEqual(written.map((o) => [o.label, o.safe]), raws.map((e) => [e.label, e.safe]), s.id)
                nStation += written.length
            }
            assert.ok(nStation >= SCENES.length, `站點數${nStation}`)
        })

        it('B4 比對器自證(與SAFE_KEYS之內容無關): 產出之鍵漏列或宣告了從未產出之鍵, 皆被指出 (R2)', function() {
            let raw = ['n', 'ks', 'skipped']
            assert.deepStrictEqual(diffKeys(raw, ['n', 'ks', 'skipped']), { missing: [], extra: [] })
            for (let k of raw) {
                assert.deepStrictEqual(diffKeys(raw, raw.filter((v) => v !== k)), { missing: [k], extra: [] }, `漏列[${k}]`)
            }
            assert.deepStrictEqual(diffKeys(raw, [...raw, 'neverProduced']), { missing: [], extra: ['neverProduced'] })
            assert.deepStrictEqual(diffKeys(raw, ['n', 'x']), { missing: ['ks', 'skipped'], extra: ['x'] })
        })

    })


    describe('C. 不匯入wsemi內部檔; getUrlSecrets已刪除(分類行為不變之接線案見unit-diaglog-wire之U22)', function() {

        it('C1 src與工具腳本不匯入wsemi底線內部檔(_diagKit.mjs等), 測試僅用共用語料_diagCases.mjs (R3)', function() {
            let scan = (dir) => {
                let out = []
                for (let f of fs.readdirSync(dir).filter((v) => v.endsWith('.mjs'))) {
                    importsOf(path.join(dir, f)).filter((s) => /(^|\/)wsemi\/src\/_|\/_[A-Za-z]+\.mjs$/.test(s)).forEach((s) => out.push(`${f} ${s}`))
                }
                return out
            }
            assert.deepStrictEqual(scan(path.resolve('./src')), [])
            assert.deepStrictEqual(scan(path.resolve('./toolg')), [])
            assert.deepStrictEqual(scan(path.resolve('./test/tools')), [])
            //測試檔: 規格D5指定接線測試以共用語料(wsemi/src/_diagCases.mjs)跑宣告之路徑, 為唯一允許者
            let allowed = new Set(['wsemi/src/_diagCases.mjs'])
            let bad = []
            for (let f of fs.readdirSync(path.resolve('./test')).filter((v) => v.endsWith('.test.mjs'))) {
                importsOf(path.resolve('./test', f)).filter((s) => /wsemi\/src\/_/.test(s) && !allowed.has(s)).forEach((s) => bad.push(`${f} ${s}`))
            }
            assert.deepStrictEqual(bad, [])
        })

        it('C2 getDiagBrief.mjs只匯出摘要與出口函數: getUrlSecrets已刪除, 全src無其蹤跡 (R4)', function() {
            assert.deepStrictEqual(Object.keys(briefMod).sort(), ['genDiag', 'getBriefCount', 'getBriefFails', 'getBriefResult', 'getBriefType'])
            let fts = path.resolve('./src')
            for (let f of fs.readdirSync(fts).filter((v) => v.endsWith('.mjs'))) {
                assert.ok(!/getUrlSecrets/.test(fs.readFileSync(path.join(fts, f), 'utf8')), f)
            }
        })

    })

})
