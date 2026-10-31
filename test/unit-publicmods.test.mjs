import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'
import WServOrm from '../src/WServOrm.mjs'
import getMapOrm from '../src/getMapOrm.mjs'
import getProc from '../src/getProc.mjs'
import checkOptRemoved from '../src/checkOptRemoved.mjs'
import genTestData from '../src/genTestData.mjs'
import getDb from '../src/getDb.mjs'
import * as baseline from '../src/baseline.mjs'
import { SAFE_KEYS } from '../src/safeKeys.mjs'
import { createMemOrm } from './tools/memOrm.mjs'
import { parseReadmeMods, checkMods } from './tools/publicMods.mjs'


//R-PUBMOD-01(2026-10-31, 排程第202項: 下游深層匯入本套件之非公開內部檔): 公開子模組清單之單一來源與契約. 本檔驗五件事
//  R1 清單之單一來源: README〈公開子模組〉段之表(公開表、內部檔表)與 src/*.mjs 實際檔案互相吻合, 新增或移除檔案須同步表(A 組); 檢核本身以變異過之 README 文字驗證會判紅
//  R2 公開子模組之匯出存在且與 README 匯出欄一致(B 組)
//  R3 每個公開子模組有契約案, 且行為與 README 所寫之承諾相符(W、K、S、O、G、T 組; 公開表之檔集合須恰等於 CONTRACTED, 新增公開列而無契約案者判紅)
//  R4 未升格之內部檔 getMapOrm、getProc 之下游用法(測試以替身資料表組真實 procOrm、以建構期檢查探測已移除之設定)皆有公開路徑且結果等價(I 組); 故不升格
//  R5 內部檔之匯入全表由下游各自之測試鎖定, 本套件不掃下游(不在本檔範圍)
//各案註解標明對應之需求句(R1-R5)


let fd = path.resolve('./test/_tmp/unit-publicmods')
let fdSrc = path.resolve('./src')
let pathReadme = path.resolve('./README.md')
let DS = { tests: { keys: ['id', 'name'] } }

//公開子模組之契約案登錄(每個公開子模組一組案, 鍵為 src 下檔名); README 公開表之檔集合須恰等於此集合
let CONTRACTED = ['WServOrm.mjs', 'baseline.mjs', 'safeKeys.mjs', 'checkOptRemoved.mjs', 'getDb.mjs', 'genTestData.mjs']

//WServOrm 回傳物件之成員(JSDoc @returns 與 README〈公開子模組〉所載)
let WSERVORM_MEMBERS = ['addFunCheck', 'addFunPostProcessing', 'addFunPreProcessing', 'backup', 'closeAll', 'guardWrite', 'procOrm', 'recover', 'withTabLocks', 'woItems']

let REMOVED_KEYS = ['useCheckUser', 'getUserById', 'useExcludeWhenNotAdmin']


function listSrc() {
    return fs.readdirSync(fdSrc).filter((v) => v.endsWith('.mjs')).sort()
}

function readReadme() {
    return fs.readFileSync(pathReadme, 'utf8')
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

//editRow: 改寫 README 文字中檔名為 file 之表列(依 | 切欄, fn 收欄陣列並回新欄陣列, 回 null 則刪除該列)
function editRow(md, file, fn) {
    let head = '| `src/' + file + '`'
    return md.split(/\r?\n/).flatMap((l) => {
        if (!l.startsWith(head)) {
            return [l]
        }
        let cs = fn(l.split('|').slice(1, -1).map((v) => v.trim()))
        return cs === null ? [] : [`| ${cs.join(' | ')} |`]
    }).join('\n')
}

function insertAfterRow(md, file, line) {
    let head = '| `src/' + file + '`'
    return md.split(/\r?\n/).flatMap((l) => (l.startsWith(head) ? [l, line] : [l])).join('\n')
}


describe('公開子模組(R-PUBMOD-01)', function() {

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
    })

    after(function() {
        fs.rmSync(fd, { recursive: true, force: true })
    })


    describe('A. 清單之單一來源: README 表 ↔ src/*.mjs', function() {

        it('A1 README〈公開子模組〉之公開表與內部檔表恰好分類 src 下全部 .mjs(不漏、不多、不重), 匯入路徑、欄數、理由皆合格 (R1)', function() {
            let parsed = parseReadmeMods(readReadme())
            assert.deepStrictEqual(checkMods(parsed, listSrc()), [])
        })

        it('A2 公開表之檔集合恰等於契約案登錄(CONTRACTED): 新增或移除公開子模組須同步增減契約案 (R1, R3)', function() {
            let parsed = parseReadmeMods(readReadme())
            assert.notStrictEqual(parsed, null, 'README 缺〈公開子模組〉段')
            assert.deepStrictEqual(parsed.public.map((v) => v.file).sort(), [...CONTRACTED].sort())
        })

        it('A3 檢核本身會判紅(變異 README 文字): 缺段、公開表少一列、內部檔表少一列、表列指向不存在之檔、同檔跨兩表、匯入路徑錯、匯出欄空、欄數錯、內部檔無理由 (R1)', function() {
            let md = readReadme()
            let files = listSrc()
            let problems = (m, fs2 = files) => checkMods(parseReadmeMods(m), fs2)
            assert.deepStrictEqual(problems(md), [], '未變異之 README 應合格')

            //缺段
            assert.deepStrictEqual(problems(md.replace('## 公開子模組', '## 其他')), ['README 缺〈公開子模組〉段'])

            //公開表少一列 → 該檔未歸類
            let m1 = problems(editRow(md, 'safeKeys.mjs', () => null))
            assert.ok(m1.some((v) => v.includes('src/safeKeys.mjs 未歸類')), m1.join(';'))

            //內部檔表少一列 → 該檔未歸類
            let m2 = problems(editRow(md, 'getMapOrm.mjs', () => null))
            assert.ok(m2.some((v) => v.includes('src/getMapOrm.mjs 未歸類')), m2.join(';'))

            //表列指向不存在之檔
            let m3 = problems(insertAfterRow(md, 'baseline.mjs', '| `src/ghost.mjs` | `w-serv-orm/src/ghost.mjs` | `default` | 用途 | 穩定 |'))
            assert.ok(m3.some((v) => v.includes('表列之 src/ghost.mjs 不存在')), m3.join(';'))

            //src 多一個檔而表未列
            let m4 = problems(md, [...files, 'zzNew.mjs'])
            assert.ok(m4.some((v) => v.includes('src/zzNew.mjs 未歸類')), m4.join(';'))

            //同檔跨兩表(內部檔表再列 baseline.mjs)
            let m5 = problems(insertAfterRow(md, 'getMapOrm.mjs', '| `src/baseline.mjs` | 理由 |'))
            assert.ok(m5.some((v) => v.includes('baseline.mjs 同時列於公開表與內部檔表')), m5.join(';'))

            //匯入路徑錯
            let m6 = problems(md.replace('`w-serv-orm/src/baseline.mjs`', '`w-serv-orm/src/baselin.mjs`'))
            assert.ok(m6.some((v) => v.includes('baseline.mjs 之匯入路徑應為')), m6.join(';'))

            //匯出欄空
            let m7 = problems(editRow(md, 'safeKeys.mjs', (cs) => [cs[0], cs[1], '', cs[3], cs[4]]))
            assert.ok(m7.some((v) => v.includes('safeKeys.mjs 之匯出欄為空')), m7.join(';'))

            //欄數錯(少穩定性承諾欄)
            let m8 = problems(editRow(md, 'safeKeys.mjs', (cs) => cs.slice(0, 4)))
            assert.ok(m8.some((v) => v.includes('safeKeys.mjs 之公開表列應有 5 欄')), m8.join(';'))

            //內部檔無理由
            let m9 = problems(editRow(md, 'getProc.mjs', (cs) => [cs[0], '']))
            assert.ok(m9.some((v) => v.includes('getProc.mjs 之內部檔列未寫理由')), m9.join(';'))

            //重複列
            let m10 = problems(insertAfterRow(md, 'safeKeys.mjs', '| `src/safeKeys.mjs` | `w-serv-orm/src/safeKeys.mjs` | `SAFE_KEYS` | 用途 | 穩定 |'))
            assert.ok(m10.some((v) => v.includes('公開表重複列出 safeKeys.mjs')), m10.join(';'))
        })

    })


    describe('B. 公開子模組之匯出存在且與 README 匯出欄一致', function() {

        it('B1 每個公開列: 匯入路徑所指之檔可載入, 其匯出名稱(含 default)恰等於 README 匯出欄 (R2)', async function() {
            let parsed = parseReadmeMods(readReadme())
            assert.notStrictEqual(parsed, null, 'README 缺〈公開子模組〉段')
            assert.ok(parsed.public.length > 0)
            for (let r of parsed.public) {
                let fn = path.resolve('.', r.importPath.replace(/^w-serv-orm\//, ''))
                assert.ok(fs.existsSync(fn), `${r.file}: ${fn}`)
                let ns = await import(pathToFileURL(fn).href)
                assert.deepStrictEqual(Object.keys(ns).sort(), [...r.exports].sort(), `${r.file} 之匯出名稱`)
            }
        })

    })


    describe('W. src/WServOrm.mjs(主入口)', function() {

        it('W1 預設匯出為建構函數, 傳入替身 WOrm 之回傳物件恰有文件載明之成員, 且 procOrm 可寫入與讀回 (R3: README 主入口承諾)', async function() {
            assert.strictEqual(typeof WServOrm, 'function')
            let mem = createMemOrm()
            let r = WServOrm(DS, mem.WOrmMem, 'stub', 'stub', { funLog: () => {} })
            assert.deepStrictEqual(Object.keys(r).sort(), WSERVORM_MEMBERS)
            await r.procOrm('u1', 'tests', 'insert', [{ id: 'a', name: 'x' }])
            let rows = await r.procOrm('u1', 'tests', 'select', {})
            assert.deepStrictEqual(rows, [{ id: 'a', name: 'x' }])
        })

    })


    describe('K. src/baseline.mjs(純函數子模組)', function() {

        it('K1 名稱與型別: BASELINE_VERSION 為 h1、BASELINE_REJECT 凍結, 其餘為函數; 空基準合法、取拒收鍵之字串原樣 (R3)', function() {
            assert.strictEqual(baseline.BASELINE_VERSION, 'h1')
            assert.ok(Object.isFrozen(baseline.BASELINE_REJECT))
            for (let k of ['cyrb53', 'checkContract', 'digestRow', 'buildBaseline', 'isBaselineValid', 'compareBaseline', 'pickWriteRow', 'getRejectKey']) {
                assert.strictEqual(typeof baseline[k], 'function', k)
            }
            assert.strictEqual(baseline.isBaselineValid([]), true)
            assert.strictEqual(baseline.getRejectKey('rowNotFound'), 'rowNotFound')
        })

    })


    describe('S. src/safeKeys.mjs(公開 SAFE_KEYS)', function() {

        it('S1 SAFE_KEYS 為凍結之字串陣列、無重複; 內容之雙向比對見 unit-diagsafe (R3)', function() {
            assert.ok(Array.isArray(SAFE_KEYS))
            assert.ok(Object.isFrozen(SAFE_KEYS))
            assert.ok(SAFE_KEYS.length > 0 && SAFE_KEYS.every((v) => typeof v === 'string' && v !== ''))
            assert.strictEqual(new Set(SAFE_KEYS).size, SAFE_KEYS.length)
        })

    })


    describe('O. src/checkOptRemoved.mjs(包裝層預先檢查已移除之設定)', function() {

        it('O1 三鍵之值為 undefined、null、false 通過並回傳 undefined (R3: README 承諾「接受之值」)', function() {
            for (let k of REMOVED_KEYS) {
                for (let v of [undefined, null, false]) {
                    assert.strictEqual(checkOptRemoved({ [k]: v }), undefined, `${k}=${String(v)}`)
                }
            }
        })

        it('O2 三鍵之值為其他值即拋 Error, 訊息以 `opt.<鍵> has been removed, ` 起首(其後提示句不屬承諾) (R3)', function() {
            for (let k of REMOVED_KEYS) {
                for (let v of [true, 0, 1, '', 'x', 'false', NaN, {}, [], () => {}]) {
                    let e = getThrow(() => checkOptRemoved({ [k]: v }))
                    assert.ok(e instanceof Error, `${k}=${String(v)}`)
                    assert.ok(e.message.startsWith(`opt.${k} has been removed, `), `${k}=${String(v)}: ${e.message}`)
                }
            }
        })

        it('O3 opt 本身未給、null、非物件亦通過; 只看三鍵, 其他鍵不受影響; 不改動 opt(凍結物件亦可) (R3)', function() {
            for (let opt of [undefined, null, {}, 'abc', 5, true]) {
                assert.strictEqual(checkOptRemoved(opt), undefined, String(opt))
            }
            let o = Object.freeze({ serverPort: 11005, webName: { eng: 'x' }, useCheckUser: false, getUserById: null, other: true })
            assert.strictEqual(checkOptRemoved(o), undefined)
            assert.strictEqual(checkOptRemoved.length, 1)
        })

        it('O4 多鍵違規時依 useCheckUser、getUserById、useExcludeWhenNotAdmin 之序報第一個 (R3)', function() {
            let e1 = getThrow(() => checkOptRemoved({ useExcludeWhenNotAdmin: true, getUserById: true, useCheckUser: true }))
            assert.ok(e1.message.startsWith('opt.useCheckUser has been removed, '), e1.message)
            let e2 = getThrow(() => checkOptRemoved({ useExcludeWhenNotAdmin: true, getUserById: true }))
            assert.ok(e2.message.startsWith('opt.getUserById has been removed, '), e2.message)
        })

    })


    describe('G. src/getDb.mjs(離線維運之備份與還原)', function() {

        it('G1 預設匯出恰有 backup 與 recover 兩個非同步函數 (R3)', function() {
            assert.deepStrictEqual(Object.keys(getDb).sort(), ['backup', 'recover'])
            assert.strictEqual(getDb.backup.constructor.name, 'AsyncFunction')
            assert.strictEqual(getDb.recover.constructor.name, 'AsyncFunction')
            assert.strictEqual(getDb.backup.length, 1)
            assert.strictEqual(getDb.recover.length, 2)
        })

        it('G2 backup 於「模組載入時之工作目錄」寫出 backup-時間.json(載入後改 cwd 不影響)且 resolve undefined; recover(woItems, fp) 依該檔以 insert 還原各表 (R3: README 承諾)', function() {
            //子行程: cwd 設於本案暫存夾; 匯入 getDb 之後才 chdir 至上層, 以證落點為載入時之 cwd
            let dir = path.join(fd, 'getdb')
            fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
            let url = pathToFileURL(path.resolve('./src/getDb.mjs')).href
            let code = [
                `import fs from 'fs'`,
                `import path from 'path'`,
                `import getDb from '${url}'`,
                `let dir = process.cwd()`,
                `process.chdir(path.join(dir, 'sub'))`,
                `let ins = []`,
                `let woItems = { tests: { select: async () => [{ id: 'a' }, { id: 'b' }], insert: async (d) => { ins.push(d); return { n: d.length, nInserted: d.length, ok: 1 } } } }`,
                `let r = await getDb.backup(woItems, { bLog: false })`,
                `let inDir = fs.readdirSync(dir).filter((v) => /^backup-.+\\.json$/.test(v))`,
                `let inSub = fs.readdirSync(path.join(dir, 'sub'))`,
                `let content = inDir.length === 1 ? JSON.parse(fs.readFileSync(path.join(dir, inDir[0]), 'utf8')) : null`,
                `let r2 = await getDb.recover(woItems, path.join(dir, inDir[0]), { bLog: false })`,
                `console.log(JSON.stringify({ r: r === undefined, r2: r2 === undefined, inDir: inDir.length, inSub, content, ins }))`,
            ].join('\n')
            let fp = path.join(dir, 'run.mjs')
            fs.writeFileSync(fp, code, 'utf8')
            let res = spawnSync(process.execPath, [fp], { cwd: dir, encoding: 'utf8' })
            assert.strictEqual(res.status, 0, res.stderr)
            let o = JSON.parse(res.stdout.trim().split(/\r?\n/).pop())
            assert.deepStrictEqual(o, {
                r: true,
                r2: true,
                inDir: 1,
                inSub: [],
                content: [{ name: 'tests', data: [{ id: 'a' }, { id: 'b' }] }],
                ins: [[{ id: 'a' }, { id: 'b' }]],
            })
        })

        it('G3 備份檔不存在時 recover reject(不假成功); backup 之某表 select 失敗時 reject 原錯誤 (R3)', async function() {
            let e1 = await quiet(() => getReject(getDb.recover({ tests: { insert: async () => ({ ok: 1 }) } }, path.join(fd, 'none.json'), { bLog: false })))
            assert.ok(String(e1).includes('fp is not exist'), String(e1))
            let boom = new Error('E-select')
            let woBad = {
                tests: {
                    select: async () => {
                        throw boom
                    },
                },
            }
            let e2 = await quiet(() => getReject(getDb.backup(woBad, { bLog: false })))
            assert.ok(e2 instanceof Error && e2.message.includes('E-select'), String(e2))
        })

    })


    describe('T. src/genTestData.mjs(離線產製測試資料)', function() {

        it('T1 預設模式 funTestAndSave: 依 ds 之鍵序逐表呼叫 ds[表].funTestAndSave(woItems), 傳入同一 woItems, 不呼叫 save (R3)', async function() {
            let log = []
            let woItems = {
                t1: {
                    save: async () => {
                        log.push('save')
                    },
                },
                t2: {},
            }
            let ds = {
                t1: {
                    funTestAndSave: async (wo) => {
                        log.push(['t1', wo === woItems])
                    },
                },
                t2: {
                    funTestAndSave: async (wo) => {
                        log.push(['t2', wo === woItems])
                    },
                },
            }
            let r = await genTestData(ds, woItems, { bLog: false })
            assert.strictEqual(r, undefined)
            assert.deepStrictEqual(log, [['t1', true], ['t2', true]])
        })

        it('T2 mode 為 funTest: 呼叫 ds[表].funTest(woItems)、經 hookFunTestData(rows) 同步轉換後交 woItems[表].save(rows); 非兩種值之 mode 同預設 (R3)', async function() {
            let saved = []
            let woItems = {
                t1: {
                    save: async (rows) => {
                        saved.push(rows)
                        return rows.map(() => ({ n: 1, ok: 1 }))
                    },
                },
            }
            let ds = {
                t1: {
                    funTest: async () => [{ id: 'a' }],
                    funTestAndSave: async () => {
                        saved.push('default-mode')
                    },
                },
            }
            await genTestData(ds, woItems, { mode: 'funTest', bLog: false, hookFunTestData: (rows) => rows.map((v) => ({ ...v, tag: 1 })) })
            assert.deepStrictEqual(saved, [[{ id: 'a', tag: 1 }]])
            saved.length = 0
            await genTestData(ds, woItems, { mode: 'bad', bLog: false })
            assert.deepStrictEqual(saved, ['default-mode'])
        })

        it('T3 funTest 模式 save 之逐筆 ok 為 0 即拋 Error, 訊息以 `failed to write test data into table[表名]: ` 起首; 聚合形 ok 為 0 亦然 (R3)', async function() {
            let ds = { t1: { funTest: async () => [{ id: 'a' }] } }
            let e1 = await getReject(genTestData(ds, { t1: { save: async () => [{ n: 1, ok: 0, err: 'E1' }] } }, { mode: 'funTest', bLog: false }))
            assert.ok(e1 instanceof Error && e1.message.startsWith('failed to write test data into table[t1]: '), e1.message)
            let e2 = await getReject(genTestData(ds, { t1: { save: async () => ({ n: 1, ok: 0 }) } }, { mode: 'funTest', bLog: false }))
            assert.ok(e2 instanceof Error && e2.message.startsWith('failed to write test data into table[t1]: '), e2.message)
        })

        it('T4 任一表失敗即停止, 之後之表不執行(逐表依序) (R3)', async function() {
            let log = []
            let ds = {
                t1: {
                    funTestAndSave: async () => {
                        log.push('t1')
                        throw new Error('E-t1')
                    },
                },
                t2: {
                    funTestAndSave: async () => {
                        log.push('t2')
                    },
                },
            }
            let e = await getReject(genTestData(ds, {}, { bLog: false }))
            assert.ok(e instanceof Error && e.message.includes('E-t1'), String(e))
            assert.deepStrictEqual(log, ['t1'])
        })

    })


    describe('I. 未升格之內部檔 getMapOrm、getProc: 下游用法皆有公開路徑且結果等價', function() {

        async function runSeq(procOrm) {
            let out = []
            out.push(await procOrm('u1', 'tests', 'insert', [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }]))
            out.push(await procOrm('u1', 'tests', 'save', [{ id: 'a', name: 'z' }]))
            out.push(await procOrm('u1', 'tests', 'select', {}))
            out.push(await procOrm('u1', 'tests', 'del', [{ id: 'b' }]))
            out.push(await getReject(procOrm('u1', 'tests', 'select', 'bad')))
            out.push(await procOrm('u1', 'tests', 'select', {}))
            return out
        }

        it('I1 以替身資料表組真實 procOrm(下游測試輔助之用法): 公開路徑 WServOrm(ds, 替身WOrm, url, db).procOrm 與內部組裝 getProc(getMapOrm(ds, woItems)).procOrm 對同一序列之回傳逐項相同 (R4)', async function() {
            //公開路徑: 替身 WOrm 為建構函數(收 { url, db, cl }, 回該表之替身), 下游 w-web-perm 之 mkCore、w-web-sso 之 mkServ 即此寫法
            let memA = createMemOrm()
            let a = await quiet(async () => {
                let so = WServOrm(DS, memA.WOrmMem, 'stub', 'stub')
                return runSeq(so.procOrm)
            })

            //內部組裝: 自備 woItems
            let memB = createMemOrm()
            let woItems = {}
            for (let k of Object.keys(DS)) {
                woItems[k] = new memB.WOrmMem({ cl: k })
            }
            let b = await quiet(async () => runSeq(getProc(getMapOrm(DS, woItems)).procOrm))

            assert.deepStrictEqual(a, b)
            assert.strictEqual(a[4], 'invalid find of select, need an object', '被拒之條件以固定字串 reject')
            assert.deepStrictEqual(memA.rows('tests'), memB.rows('tests'))
        })

        it('I2 下游以 getProc 建構期拋錯探測「已移除設定」(w-web-sso 之 IOK-007): 公開路徑 checkOptRemoved 與 WServOrm 建構之拋錯訊息與 getProc 逐值相同 (R4)', function() {
            let mem = createMemOrm()
            let mapOrm = getMapOrm(DS, {})
            for (let k of REMOVED_KEYS) {
                for (let v of [undefined, null, false, true, 0, '', 'x', {}, []]) {
                    let probe = (fn) => {
                        try {
                            fn()
                            return 'ok'
                        }
                        catch (err) {
                            return err.message
                        }
                    }
                    let viaGetProc = probe(() => getProc(mapOrm, { [k]: v }))
                    let viaCheck = probe(() => checkOptRemoved({ [k]: v }))
                    let viaCtor = probe(() => WServOrm(DS, mem.WOrmMem, 'stub', 'stub', { [k]: v, funLog: () => {} }))
                    assert.strictEqual(viaCheck, viaGetProc, `${k}=${String(v)}`)
                    assert.strictEqual(viaCtor, viaGetProc, `${k}=${String(v)}`)
                }
            }
        })

        it('I3 未升格之內部檔皆登錄於 README 內部檔表且各有理由(含 getMapOrm、getProc、getWoItems、getSettings、getDbBackupAndRecover、getDiagBrief、isOrmFail) (R1, R4)', function() {
            let parsed = parseReadmeMods(readReadme())
            assert.notStrictEqual(parsed, null, 'README 缺〈公開子模組〉段')
            let want = ['getMapOrm.mjs', 'getProc.mjs', 'getWoItems.mjs', 'getSettings.mjs', 'getDbBackupAndRecover.mjs', 'getDiagBrief.mjs', 'isOrmFail.mjs']
            assert.deepStrictEqual(parsed.internal.map((v) => v.file).sort(), want.sort())
            for (let r of parsed.internal) {
                assert.ok(r.reason.length >= 8, `${r.file} 之理由過短: ${r.reason}`)
            }
        })

    })

})
