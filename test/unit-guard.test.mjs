import assert from 'assert'
import WServOrm from '../src/WServOrm.mjs'
import { buildBaseline } from '../src/baseline.mjs'
import { createMemOrm } from './tools/memOrm.mjs'
import { getReject, quiet } from './tools/ormStub.mjs'


//規格: 多人同時編輯之寫入契約 §6、§7、V1、V6、V7、V12、V13、V14; 規則帳本 R-LOCK-01、R-GUARD-01、R-ONLYMOD-01
//以有狀態之記憶體ORM(test/tools/memOrm.mjs)驗證表鎖、guardWrite與procOrm之opt(mustExist); 真後端(lowdb)見 api-guard.test.mjs
//
//規格句對照(spec = C:\opensrcOper\dspec\多人同時編輯之寫入契約.md):
//  L01-L07 §7「每表一鍵; 每個 w-serv-orm 實例一個鎖管理器(withTabLocks). 多表依表名碼元排序取鎖」「不可重入」
//  W01-W03 §6「原子: 讀取、比對、diff、寫入在同一表鎖內(guardWrite)」、V1「B 以舊基準存 → 整次拒收、零寫入」  W04 V12「清單頁多列提交其中一列過期 → 零寫入」
//  W05 §1「不帶基準之寫入照常寫入」(仍取鎖)  W06 §5「不識之格式或版本一律拒收 baselineFormat, 不得降級為不帶基準」、V13  W07 §5「逐列存檔之基準」、V6、§6「rowNotFound」
//  W11-W12 V14「比對與寫入間插入他人寫入(含同步、系統直寫) → 不可能發生(同鎖)」、V2
//  M01-M06 §6「修改:只改不增(autoInsert:false); 列已不存在 → rowNotFound」、V6  M07-M08 §6「刪除:檢查存在…未命中 → rowNotFound(不帶基準者亦同)」、V7
//  M09-M14 實作者補強(事後偵測、select 失敗、opt 驗證、擴充函數形狀), 見規則帳本 R-ONLYMOD-01  M15 任務「不得改變: procOrm 既有四參數呼叫之行為」

let wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

//withTimeout: 死結時以逾時而非整份測試卡死回報
function withTimeout(pm, ms, label) {
    let t = null
    let tm = new Promise((resolve, reject) => {
        t = setTimeout(() => reject(new Error(`逾時(疑似死結): ${label}`)), ms)
    })
    return Promise.race([pm, tm]).finally(() => clearTimeout(t))
}

let KEYS = ['id', 'name', 'order', 'timeUpdate', 'userIdUpdate']

//mkSo: 建立實例; names為資料表名, 各表之keys同
function mkSo(names = ['a', 'b', 'c']) {
    let ds = {}
    for (let n of names) {
        ds[n] = { keys: KEYS }
    }
    let m = createMemOrm()
    let so = WServOrm(ds, m.WOrmMem, './unused', 'db')
    return { so, m }
}

let CG = { table: 'a', pk: 'id', fields: ['name'], orderKey: 'order' }


describe('withTabLocks 每實例共用表鎖(規格 §7)', function() {

    it('L01 同表之呼叫循序執行(先進先出), 不同表並行', async function() {
        let { so } = mkSo()
        let log = []
        let job = (tabs, name, ms) => so.withTabLocks(tabs, async () => {
            log.push(`${name}:in`)
            await wait(ms)
            log.push(`${name}:out`)
            return name
        })
        let rs = await Promise.all([job(['a'], 'x', 30), job(['a'], 'y', 5), job(['a'], 'z', 1)])
        assert.deepStrictEqual(rs, ['x', 'y', 'z'])
        assert.deepStrictEqual(log, ['x:in', 'x:out', 'y:in', 'y:out', 'z:in', 'z:out'])

        log.length = 0
        await Promise.all([job(['a'], 'p', 30), job(['b'], 'q', 30)])
        assert.deepStrictEqual(log.slice(0, 2), ['p:in', 'q:in'], '不同表之鎖互不阻擋')
    })

    it('L02 回傳fn之結果; fn reject原樣轉出且鎖已釋放(後續呼叫照常執行)', async function() {
        let { so } = mkSo()
        assert.strict.equal(await so.withTabLocks(['a'], () => 42), 42, '同步fn亦可')
        let err = await getReject(so.withTabLocks(['a'], async () => {
            await wait(5)
            return Promise.reject('boom')
        }))
        assert.strict.equal(err, 'boom')
        let e2 = await getReject(so.withTabLocks(['a'], async () => {
            throw new Error('thrown')
        }))
        assert.strict.equal(e2.message, 'thrown')
        let e3 = await getReject(so.withTabLocks(['a', 'b'], () => {
            throw new Error('sync-throw')
        }))
        assert.strict.equal(e3.message, 'sync-throw', '同步拋錯亦為reject, 多表之鎖皆釋放')
        assert.strict.equal(await withTimeout(so.withTabLocks(['b', 'a'], async () => 'both-free'), 1000, '多表鎖未釋放'), 'both-free')
        assert.strict.equal(await withTimeout(so.withTabLocks(['a'], async () => 'after'), 1000, '失敗後之鎖未釋放'), 'after')
    })

    it('L03 多表取鎖依表名碼元序且不死結: 交錯之兩組多表呼叫與隨機100組呼叫皆完成, 且同表不同時有兩人在鎖內', async function() {
        let { so } = mkSo(['a', 'b', 'c'])
        let inside = { a: 0, b: 0, c: 0 }
        let maxInside = { a: 0, b: 0, c: 0 }
        let done = 0
        let job = (tabs, ms) => so.withTabLocks(tabs, async () => {
            for (let t of tabs) {
                inside[t]++
                maxInside[t] = Math.max(maxInside[t], inside[t])
            }
            await wait(ms)
            for (let t of tabs) {
                inside[t]--
            }
            done++
        })

        //明確交錯: 取鎖順序若依呼叫端給之次序會互等
        await withTimeout(Promise.all([job(['a', 'b'], 20), job(['b', 'a'], 20), job(['c', 'b', 'a'], 5), job(['a', 'c'], 5)]), 3000, '交錯多表')
        assert.strict.equal(done, 4)

        //隨機(固定種子, 可重現)
        let seed = 12345
        let rnd = (n) => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            return seed % n
        }
        let all = ['a', 'b', 'c']
        let ps = []
        for (let i = 0; i < 100; i++) {
            let tabs = all.filter(() => rnd(2) === 1)
            if (tabs.length === 0) {
                tabs = [all[rnd(3)]]
            }
            tabs.sort(() => rnd(3) - 1)
            ps.push(job(tabs, rnd(3)))
        }
        await withTimeout(Promise.all(ps), 10000, '隨機多表')
        assert.strict.equal(done, 104)
        assert.deepStrictEqual(maxInside, { a: 1, b: 1, c: 1 }, '同表同時只有一人在鎖內')
    })

    it('L03b 取鎖次序為表名UTF-16碼元遞增(可觀察): 先持有後取得之表, 才能證明前面之表已被占住; 大寫在小寫之前(非localeCompare)', async function() {
        //表名 'B'(66) 與 'a'(97): 碼元序 B < a, localeCompare 則 a < B
        let { so } = mkSo(['a', 'B', 'c'])
        let log = []
        let holder = so.withTabLocks(['a'], async () => {
            log.push('holder:in')
            await wait(80)
            log.push('holder:out')
        })
        await wait(10)
        //x 宣告 ['a', 'B']: 碼元序先取 B 再取 a(a 被 holder 占住而等待), 故等待期間 x 持有 B
        let x = so.withTabLocks(['a', 'B'], async () => {
            log.push('x:in')
            await wait(10)
            log.push('x:out')
        })
        await wait(10)
        //y 只要 B: 若 x 依碼元序先取了 B, y 會被擋到 x 完成; 若 x 先取 a(如 localeCompare 或呼叫端次序), B 空著, y 會立即執行
        let y = so.withTabLocks(['B'], async () => {
            log.push('y:in')
        })
        await Promise.all([holder, x, y])
        assert.deepStrictEqual(log, ['holder:in', 'holder:out', 'x:in', 'x:out', 'y:in'])

        //反向對照: 取鎖次序若依呼叫端給之次序(['B','a'])與碼元序同, 此例以 ['B', 'a'] 呼叫結果相同(證明排序與給定次序無關)
        log.length = 0
        let holder2 = so.withTabLocks(['a'], async () => {
            log.push('holder:in')
            await wait(80)
            log.push('holder:out')
        })
        await wait(10)
        let x2 = so.withTabLocks(['B', 'a'], async () => {
            log.push('x:in')
        })
        await wait(10)
        let y2 = so.withTabLocks(['B'], async () => {
            log.push('y:in')
        })
        await Promise.all([holder2, x2, y2])
        assert.deepStrictEqual(log, ['holder:in', 'holder:out', 'x:in', 'y:in'])
    })

    it('L04 表名去重: 同一表重複給予不自我死結', async function() {
        let { so } = mkSo()
        assert.strict.equal(await withTimeout(so.withTabLocks(['a', 'a', 'b', 'a'], async () => 'ok'), 1000, '重複表名'), 'ok')
    })

    it('L05 輸入檢查: 非陣列、空陣列、非字串、不屬於本實例之表名、fn非函數皆reject Error, 不取鎖', async function() {
        let { so } = mkSo(['a', 'b'])
        let bads = [
            ['a', undefined], [[], () => 1], ['a', () => 1], [null, () => 1], [[1], () => 1], [['x'], () => 1], [['a', 'x'], () => 1], [['toString'], () => 1], [['__proto__'], () => 1], [['a'], null], [['a'], 'f'],
        ]
        for (let [tabs, fn] of bads) {
            let e = await getReject(so.withTabLocks(tabs, fn))
            assert.ok(e instanceof Error && /invalid (tableNames|fn) of withTabLocks/.test(e.message), `${JSON.stringify(tabs)} → ${e.message}`)
        }
        assert.strict.equal(await withTimeout(so.withTabLocks(['a'], () => 'free'), 1000, '被拒之呼叫不得占鎖'), 'free')
    })

    it('L06 每實例各一個鎖管理器: 兩個實例之同名表互不阻擋', async function() {
        let o1 = mkSo()
        let o2 = mkSo()
        let log = []
        let job = (so, name) => so.withTabLocks(['a'], async () => {
            log.push(`${name}:in`)
            await wait(30)
            log.push(`${name}:out`)
        })
        await Promise.all([job(o1.so, 'p'), job(o2.so, 'q')])
        assert.deepStrictEqual(log.slice(0, 2), ['p:in', 'q:in'])
    })

    it('L07 不可重入(JSDoc載明之限制): fn內對同表再取鎖永不返回, 而非重入', async function() {
        let { so } = mkSo()
        let settled = false
        let p = so.withTabLocks(['a'], async () => {
            await so.withTabLocks(['a'], async () => 1)
            return 2
        })
        p.then(() => {
            settled = true
        }, () => {
            settled = true
        })
        await wait(150)
        assert.strict.equal(settled, false)
        //不同表且依全域遞增序(先a後b)巢狀: 單獨一組可完成(不保證與其他呼叫交錯時不死結, 見L08)
        let { so: so2 } = mkSo()
        let r = await withTimeout(so2.withTabLocks(['a'], () => so2.withTabLocks(['b'], async () => 'nested-other')), 1000, '巢狀不同表')
        assert.strict.equal(r, 'nested-other')
    })

    it('L08 跨層巢狀取不同表之死結(JSDoc與README載明之限制, 外審sol#7): 兩呼叫一個先持b再等a、一個先持a再等b, 各自排序無法修正跨層次序; 巢狀只能依全域遞增序, 或一次宣告全部表', async function() {
        let { so } = mkSo(['a', 'b'])
        let settled = 0
        let hold = () => wait(40)
        //呼叫1: 外層持 b, 內層再取 a(降序); 呼叫2: 外層持 a, 內層再取 b(升序)
        so.withTabLocks(['b'], async () => {
            await hold()
            await so.withTabLocks(['a'], async () => 1)
        }).then(() => {
            settled++
        }, () => {
            settled++
        })
        so.withTabLocks(['a'], async () => {
            await hold()
            await so.withTabLocks(['b'], async () => 2)
        }).then(() => {
            settled++
        }, () => {
            settled++
        })
        await wait(250)
        assert.strict.equal(settled, 0, '兩呼叫互等, 皆未返回(降序之巢狀取鎖為使用端之錯)')

        //正確作法: 一次宣告全部表(內部依碼元序取鎖), 交錯呼叫皆完成
        let { so: so2 } = mkSo(['a', 'b'])
        let rs = await withTimeout(Promise.all([
            so2.withTabLocks(['b', 'a'], async () => {
                await hold()
                return 1
            }),
            so2.withTabLocks(['a', 'b'], async () => {
                await hold()
                return 2
            }),
        ]), 2000, '一次宣告全部表')
        assert.deepStrictEqual(rs, [1, 2])
    })

})


describe('guardWrite 原子防護(規格 §6、V1、V12、V13、V14)', function() {

    //seed: 寫入初始列並回傳基準
    async function seed(so, rows) {
        await so.procOrm('u0', 'a', 'save', rows)
        let now = await so.woItems.a.select({})
        return { rows: now, baseline: buildBaseline(now, CG) }
    }
    let read = (so) => () => so.woItems.a.select({})

    it('W01 相符時依序read、write(rows)並回傳write之結果; write收到read之列', async function() {
        let { so } = mkSo()
        let { rows, baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }])
        let got = null
        let r = await so.guardWrite({
            tables: ['a'],
            read: read(so),
            baseline,
            contract: CG,
            write: async (rs) => {
                got = rs
                return 'written'
            },
        })
        assert.strict.equal(r, 'written')
        assert.deepStrictEqual(got.map((v) => v.id).sort(), ['r1', 'r2'])
        assert.strict.equal(got.length, rows.length)
    })

    it('W02 不符時reject Error(message與key為固定拒收鍵, 附added/removed/changed/reordered), write不被呼叫、資料不變(V1)', async function() {
        let { so, m } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }])
        //他人先存: 改r1、刪r2、增r3
        await so.procOrm('u1', 'a', 'save', [{ id: 'r1', name: 'A-other' }, { id: 'r3', name: 'C', order: 3 }])
        await so.procOrm('u1', 'a', 'del', [{ id: 'r2' }])
        let before = JSON.stringify(m.rows('a'))
        let called = 0
        let e = await getReject(so.guardWrite({
            tables: ['a'],
            read: read(so),
            baseline,
            contract: CG,
            write: async () => {
                called++
            },
        }))
        assert.ok(e instanceof Error)
        assert.strict.equal(e.message, 'baselineMismatch')
        assert.strict.equal(e.key, 'baselineMismatch')
        assert.deepStrictEqual(e.added, ['r3'])
        assert.deepStrictEqual(e.removed, ['r2'])
        assert.deepStrictEqual(e.changed, ['r1'])
        assert.strict.equal(e.reordered, false)
        assert.strict.equal(called, 0)
        assert.strict.equal(JSON.stringify(m.rows('a')), before)
    })

    it('W03 同一基準之兩次寫入, 先動先贏: 第二次整次拒收且零寫入(V1)', async function() {
        let { so, m } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }])
        let save = (name) => so.guardWrite({
            tables: ['a'],
            read: read(so),
            baseline,
            contract: CG,
            write: () => so.procOrm('u', 'a', 'save', [{ id: 'r1', name }], { mustExist: true }),
        })
        await save('first')
        let nSave = m.callsOf('save').length
        let e = await getReject(save('second'))
        assert.strict.equal(e.key, 'baselineMismatch')
        assert.strict.equal(m.callsOf('save').length, nSave, '第二次零寫入')
        assert.strict.equal(m.rows('a')[0].name, 'first')
    })

    it('W04 清單頁多列提交其中一列過期: 整份零寫入(V12)', async function() {
        let { so, m } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }, { id: 'r3', name: 'C', order: 3 }])
        await so.procOrm('u1', 'a', 'save', [{ id: 'r3', name: 'C-other' }]) //他人只改r3
        let nSave = m.callsOf('save').length
        let e = await getReject(so.guardWrite({
            tables: ['a'],
            read: read(so),
            baseline,
            contract: CG,
            write: () => so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A2' }, { id: 'r2', name: 'B2' }], { mustExist: true }),
        }))
        assert.strict.equal(e.key, 'baselineMismatch')
        assert.deepStrictEqual(e.changed, ['r3'])
        assert.strict.equal(m.callsOf('save').length, nSave)
        assert.deepStrictEqual(m.rows('a').map((v) => v.name), ['A', 'B', 'C-other'])
    })

    it('W05 baseline為undefined(不帶基準): 跳過比對照常寫入, 仍取鎖與讀取', async function() {
        let { so } = mkSo()
        await seed(so, [{ id: 'r1', name: 'A', order: 1 }])
        await so.procOrm('u1', 'a', 'save', [{ id: 'r1', name: 'changed-by-other' }])
        let log = []
        let calls = []
        let g1 = so.guardWrite({
            tables: ['a'],
            read: async () => {
                log.push('g1:read')
                calls.push('read')
                await wait(30)
                return so.woItems.a.select({})
            },
            write: async (rows) => {
                log.push('g1:write')
                assert.strict.equal(rows.length, 1)
            },
        })
        let g2 = so.withTabLocks(['a'], async () => {
            log.push('g2:in')
        })
        await Promise.all([g1, g2])
        assert.deepStrictEqual(log, ['g1:read', 'g1:write', 'g2:in'], '不帶基準之寫入仍與其他寫入者互斥')
        assert.deepStrictEqual(calls, ['read'])
    })

    it('W06 baseline為null或格式不合或版本不識: reject baselineFormat, 不降級為不帶基準, write不被呼叫(V13)', async function() {
        let { so, m } = mkSo()
        await seed(so, [{ id: 'r1', name: 'A', order: 1 }])
        let nSave = m.callsOf('save').length
        let called = 0
        for (let b of [null, 'x', 5, {}, [['r1']], [['r1', 'h2:0123456789abcd']], [['r1', 'h1:0123456789abcd'], ['r1', 'h1:0123456789abcd']], [['r1', 'm5zq9x1k']]]) {
            let e = await getReject(so.guardWrite({
                tables: ['a'],
                read: read(so),
                baseline: b,
                contract: CG,
                write: async () => {
                    called++
                },
            }))
            assert.strict.equal(e.key, 'baselineFormat', JSON.stringify(b))
            assert.strict.equal(e.message, 'baselineFormat')
        }
        assert.strict.equal(called, 0)
        assert.strict.equal(m.callsOf('save').length, nSave)
    })

    it('W07 逐列存檔之基準: 該列已被刪 → rowNotFound; 該列被改 → baselineMismatch(V6、V7之前置)', async function() {
        let { so } = mkSo()
        let { rows } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }])
        let blOne = buildBaseline(rows.filter((v) => v.id === 'r1'), CG)
        let readOne = () => so.woItems.a.select({ id: { $in: ['r1'] } })
        let w = () => 'x'
        await so.procOrm('u1', 'a', 'save', [{ id: 'r1', name: 'A-other' }])
        let e1 = await getReject(so.guardWrite({ tables: ['a'], read: readOne, baseline: blOne, contract: CG, write: w }))
        assert.strict.equal(e1.key, 'baselineMismatch')
        await so.procOrm('u1', 'a', 'del', [{ id: 'r1' }])
        let e2 = await getReject(so.guardWrite({ tables: ['a'], read: readOne, baseline: blOne, contract: CG, write: w }))
        assert.strict.equal(e2.key, 'rowNotFound')
        assert.deepStrictEqual(e2.removed, ['r1'])
    })

    it('W08 write自身之reject原樣轉出(字串不包裝)且鎖已釋放; read回非陣列為Error且鎖已釋放', async function() {
        let { so } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }])
        let e1 = await getReject(so.guardWrite({ tables: ['a'], read: read(so), baseline, contract: CG, write: () => Promise.reject('failed to save data') }))
        assert.strict.equal(e1, 'failed to save data')
        let e2 = await getReject(so.guardWrite({ tables: ['a'], read: async () => 'not-array', baseline, contract: CG, write: () => 1 }))
        assert.ok(e2 instanceof Error && /read needs to resolve an array/.test(e2.message))
        let e3 = await getReject(so.guardWrite({
            tables: ['a'],
            read: async () => {
                throw new Error('read failed')
            },
            baseline,
            contract: CG,
            write: () => 1
        }))
        assert.strict.equal(e3.message, 'read failed')
        let r = await withTimeout(so.guardWrite({ tables: ['a'], read: read(so), baseline, contract: CG, write: () => 'ok-after' }), 1000, '失敗後之鎖未釋放')
        assert.strict.equal(r, 'ok-after')
    })

    it('W09 輸入檢查: 非物件、read或write非函數、帶基準而無契約、契約無效、contract.table不在tables內、tables無效皆reject Error且不取鎖', async function() {
        let { so } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }])
        let ok = { tables: ['a'], read: read(so), baseline, contract: CG, write: () => 1 }
        let cases = [
            [undefined, /need an object/], [null, /need an object/], ['x', /need an object/],
            [{ ...ok, read: null }, /invalid read/], [{ ...ok, write: 'f' }, /invalid write/],
            [{ ...ok, contract: undefined }, /invalid contract/], [{ ...ok, contract: { pk: 'id' } }, /invalid contract/],
            [{ ...ok, contract: { ...CG, fields: ['name', 'order'] } }, /fields must not contain orderKey/],
            [{ ...ok, tables: ['b'] }, /need to contain contract.table/], [{ ...ok, tables: 'a' }, /need to contain contract.table/],
            [{ ...ok, tables: [], contract: { ...CG, table: undefined } }, /invalid tableNames/], [{ ...ok, tables: ['zzz'], contract: { ...CG, table: undefined } }, /invalid tableNames/],
        ]
        for (let [p, re] of cases) {
            let e = await getReject(so.guardWrite(p))
            assert.ok(e instanceof Error && re.test(e.message), `${e.message} 不符 ${re}`)
        }
        //未帶基準而給了無效契約者亦檢查(及早發現使用端之錯誤)
        let e = await getReject(so.guardWrite({ tables: ['a'], read: read(so), contract: { pk: 'id' }, write: () => 1 }))
        assert.ok(/invalid contract/.test(e.message))
        assert.strict.equal(await withTimeout(so.guardWrite({ tables: ['a'], read: read(so), write: () => 'free' }), 1000, '被拒之呼叫不得占鎖'), 'free')
    })

    it('W10 多表guardWrite: 交錯之兩組多表呼叫不死結', async function() {
        let { so } = mkSo(['a', 'b'])
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }])
        let mk = (tables, ms) => so.guardWrite({
            tables,
            read: async () => {
                await wait(ms)
                return so.woItems.a.select({})
            },
            baseline,
            contract: CG,
            write: async () => 'ok',
        })
        let rs = await withTimeout(Promise.all([mk(['a', 'b'], 20), mk(['b', 'a'], 20), mk(['b', 'a'], 1)]), 3000, '多表guardWrite')
        assert.deepStrictEqual(rs, ['ok', 'ok', 'ok'])
    })

    it('W11 原子(V14): 比對與寫入之間插不進他人之寫入(含另一withTabLocks呼叫與另一guardWrite), 他人於其後才執行', async function() {
        let { so } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'orig', order: 1 }])
        let log = []

        let g = so.guardWrite({
            tables: ['a'],
            read: async () => {
                log.push('g:read-start')
                await wait(40)
                log.push('g:read-end')
                return so.woItems.a.select({})
            },
            baseline,
            contract: CG,
            write: async () => {
                log.push('g:write-start')
                await wait(40)
                await so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'from-g' }], { mustExist: true })
                log.push('g:write-end')
            },
        })

        await wait(10) //g已在讀取之人為延遲內
        let x = so.withTabLocks(['a'], async () => {
            log.push('x:in')
            await so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'from-x' }])
            log.push('x:out')
        })
        let y = so.guardWrite({
            tables: ['a'],
            read: read(so),
            baseline,
            contract: CG,
            write: async () => {
                log.push('y:write')
            },
        }).catch((e) => log.push(`y:${e.key}`))

        await Promise.all([g, x, y])
        assert.deepStrictEqual(log, ['g:read-start', 'g:read-end', 'g:write-start', 'g:write-end', 'x:in', 'x:out', 'y:baselineMismatch'])
        assert.strict.equal(so.woItems.a && (await so.woItems.a.select({}))[0].name, 'from-x')
    })

    it('W12 不帶基準之他人寫入(外部同步型: 整段delAll加insert)取鎖後, guardWrite於其後讀到完整新資料而非中間態', async function() {
        let { so } = mkSo()
        let { baseline } = await seed(so, [{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }])
        let sync = so.withTabLocks(['a'], async () => {
            await so.woItems.a.delAll({})
            await wait(40) //中間態: 表為空
            await so.woItems.a.insert([{ id: 'r1', name: 'A', order: 1 }, { id: 'r2', name: 'B', order: 2 }])
        })
        await wait(10)
        let seen = null
        let g = so.guardWrite({
            tables: ['a'],
            read: read(so),
            baseline,
            contract: CG,
            write: async (rows) => {
                seen = rows.length
            },
        })
        await Promise.all([sync, g])
        assert.strict.equal(seen, 2, '內容未變之同步不使基準失效(V2), 且guardWrite不會讀到空表')
    })

})


describe('procOrm opt: mustExist 只改不增與刪除未命中(規格 §6、V6、V7)', function() {

    let proc = (so) => (mode, input, opt) => so.procOrm('u1', 'a', mode, input, opt)

    it('M01 修改不存在之列: reject rowNotFound, 列未被建立且未呼叫ORM之save(V6)', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        let err = await quiet(() => getReject(p('save', [{ id: 'ghost', name: 'x' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal(m.callsOf('save').length, 0)
        assert.strict.equal(m.tables.a.size, 0)
    })

    it('M02 多列中一列不存在: 零寫入(存在之列亦不改)', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        m.reset()
        let err = await quiet(() => getReject(p('save', [{ id: 'r1', name: 'A2' }, { id: 'ghost', name: 'x' }, { id: 'r2', name: 'B2' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal(m.callsOf('save').length, 0)
        assert.deepStrictEqual(m.rows('a').map((v) => v.name), ['A', 'B'])
    })

    it('M03 全部存在: 正常修改, 回傳id陣列, 轉傳autoInsert:false給ORM之save, 存在檢查為單次select({id:{$in}})且去重', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        m.reset()
        let r = await p('save', [{ id: 'r1', name: 'A2' }, { id: 'r2', name: 'B2' }, { id: 'r1', name: 'A3' }], { mustExist: true })
        assert.deepStrictEqual(r, [{ id: 'r1' }, { id: 'r2' }, { id: 'r1' }])
        assert.deepStrictEqual(m.callsOf('select').map((c) => c.args), [[{ id: { $in: ['r1', 'r2'] } }]])
        let saves = m.callsOf('save')
        assert.strict.equal(saves.length, 1)
        assert.deepStrictEqual(saves[0].args[1], { autoInsert: false })
        assert.deepStrictEqual(m.rows('a').map((v) => v.name), ['A3', 'B2'])
        //單一物件輸入亦可
        let r1 = await p('save', { id: 'r2', name: 'B3' }, { mustExist: true })
        assert.deepStrictEqual(r1, { id: 'r2' })
    })

    it('M03b 大批: 存在檢查分批(每批至多1000個主鍵, 避開各w-orm-*共用之$in上限10000); 12000列全存在可修改, 缺於最後一批者零寫入', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        let rows = []
        for (let i = 0; i < 12000; i++) {
            rows.push({ id: `id-${i}`, name: 'A' })
        }
        await p('save', rows)
        m.reset()
        let r = await p('save', rows.map((v) => ({ ...v, name: 'B' })), { mustExist: true })
        assert.strict.equal(r.length, 12000)
        let sels = m.callsOf('select')
        assert.strict.equal(sels.length, 12)
        assert.strict.equal(sels.every((c) => c.args[0].id.$in.length <= 1000), true)
        assert.strict.equal(m.rows('a').every((v) => v.name === 'B'), true)

        m.reset()
        let withGhost = rows.map((v) => ({ ...v, name: 'C' }))
        withGhost.push({ id: 'ghost-in-last-chunk', name: 'C' })
        let err = await quiet(() => getReject(p('save', withGhost, { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound')
        assert.strict.equal(m.callsOf('save').length, 0, '缺於最後一批, 仍零寫入')
        assert.strict.equal(m.rows('a')[0].name, 'B')

        let e2 = await quiet(() => getReject(p('del', [...rows, { id: 'ghost' }], { mustExist: true })))
        assert.strict.equal(e2, 'rowNotFound')
        assert.strict.equal(m.rows('a').length, 12000)
        let r3 = await p('del', rows, { mustExist: true })
        assert.strict.equal(r3.length, 12000)
        assert.strict.equal(m.rows('a').length, 0)
    })

    it('M04 未帶opt或mustExist為false: 既有行為不變(不存在之列被新增, ORM之save為單參數呼叫, 無額外select)', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        for (let opt of [undefined, null, {}, { mustExist: false }]) {
            m.reset()
            m.tables.a.clear()
            let r = await p('save', [{ id: 'new1', name: 'N' }], opt)
            assert.deepStrictEqual(r, [{ id: 'new1' }])
            assert.strict.equal(m.callsOf('select').length, 0)
            assert.strict.equal(m.callsOf('save')[0].args.length, 1)
            assert.strict.equal(m.rows('a').length, 1)
        }
    })

    it('M05 修改時未帶主鍵之列: 視為不存在, reject rowNotFound且不補號新增(反); 帶主鍵者照常(正)', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }])
        m.reset()
        for (let input of [[{ name: 'no-id' }], { name: 'no-id' }, [{ id: 'r1', name: 'ok' }, { name: 'no-id' }], [{ id: '', name: 'empty-id' }], {}]) {
            let err = await quiet(() => getReject(p('save', input, { mustExist: true })))
            assert.strict.equal(err, 'rowNotFound', JSON.stringify(input))
        }
        assert.strict.equal(m.callsOf('save').length, 0)
        assert.strict.equal(m.tables.a.size, 1)
        assert.deepStrictEqual(await p('save', [{ id: 'r1', name: 'ok' }], { mustExist: true }), [{ id: 'r1' }])
    })

    it('M06 空陣列之修改視為無事可做, 不查詢不寫入', async function() {
        let { so, m } = mkSo()
        let r = await proc(so)('save', [], { mustExist: true })
        assert.deepStrictEqual(r, [])
        assert.strict.equal(m.callsOf('select').length, 0, '無列可查, 不發存在檢查')
        assert.strict.equal(m.callsOf('save').every((c) => c.args[0].length === 0), true, '若呼叫ORM之save, 內容亦為空陣列(既有行為)')
        assert.strict.equal(m.tables.a.size, 0)
    })

    it('M07 刪除: 任一列不存在即零刪除並reject rowNotFound(含單列)(V7); 全部存在則刪除; 未帶opt之刪除未命中仍回ORM逐筆結果', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        m.reset()
        let e1 = await quiet(() => getReject(p('del', [{ id: 'ghost' }], { mustExist: true })))
        assert.strict.equal(e1, 'rowNotFound')
        let e2 = await quiet(() => getReject(p('del', [{ id: 'r1' }, { id: 'ghost' }, { id: 'r2' }], { mustExist: true })))
        assert.strict.equal(e2, 'rowNotFound')
        assert.strict.equal(m.callsOf('del').length, 0)
        assert.strict.equal(m.rows('a').length, 2)
        let r = await p('del', [{ id: 'r1' }, { id: 'r2' }], { mustExist: true })
        assert.deepStrictEqual(r, [{ n: 1, nDeleted: 1, ok: 1 }, { n: 1, nDeleted: 1, ok: 1 }])
        assert.strict.equal(m.rows('a').length, 0)
        //重複刪除: 已不存在
        let e3 = await quiet(() => getReject(p('del', [{ id: 'r1' }], { mustExist: true })))
        assert.strict.equal(e3, 'rowNotFound')
        //預設行為不變
        let r0 = await p('del', [{ id: 'r1' }])
        assert.deepStrictEqual(r0, [{ n: 0, nDeleted: 0, ok: 1 }])
    })

    it('M08 刪除之列無有效主鍵(null、空字串、布林、非物件): 視為不存在, reject rowNotFound且零刪除', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }])
        m.reset()
        for (let input of [[{ id: 'r1' }, { id: null }], [{ id: 'r1' }, {}], [{ id: 'r1' }, { id: true }], [{ id: 'r1' }, 'r1'], [{ id: 'r1' }, { id: '' }]]) {
            let err = await quiet(() => getReject(p('del', input, { mustExist: true })))
            assert.strict.equal(err, 'rowNotFound', JSON.stringify(input))
        }
        assert.strict.equal(m.callsOf('del').length, 0)
        assert.strict.equal(m.rows('a').length, 1)
    })

    it('M07b 刪除之同批重複主鍵(mustExist): 整批拒絕且零刪除(否則第1筆刪除後第2筆必未命中, 事後偵測雖reject卻已刪, 外審sol#1); 訊息列位置不回顯主鍵; 存檔之重複主鍵不受影響', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'secret-r1', name: 'A' }, { id: 'r2', name: 'B' }])
        m.reset()
        let e1 = await quiet(() => getReject(p('del', [{ id: 'secret-r1' }, { id: 'secret-r1' }], { mustExist: true })))
        assert.strict.equal(e1, 'invalid input of del, duplicate id: data[1]')
        assert.ok(e1.indexOf('secret-r1') < 0)
        let e2 = await quiet(() => getReject(p('del', [{ id: 'r2' }, { id: 'secret-r1' }, { id: 'r2' }, { id: 'secret-r1' }], { mustExist: true })))
        assert.strict.equal(e2, 'invalid input of del, duplicate id: data[2], data[3]')
        assert.strict.equal(m.callsOf('del').length, 0)
        assert.strict.equal(m.rows('a').length, 2, '零刪除')
        //數字與其字串為同一主鍵(R-ID-02)
        let e3 = await quiet(() => getReject(p('del', [{ id: 7 }, { id: '7' }], { mustExist: true })))
        assert.strict.equal(e3, 'invalid input of del, duplicate id: data[1]')
        //無效主鍵不計入重複(由存在檢查以rowNotFound處置)
        let e4 = await quiet(() => getReject(p('del', [{ id: null }, { id: null }], { mustExist: true })))
        assert.strict.equal(e4, 'rowNotFound')
        //未帶mustExist之del對重複主鍵之既有行為不變(第1筆命中、第2筆未命中, 不視為錯誤)
        let r0 = await p('del', [{ id: 'r2' }, { id: 'r2' }])
        assert.deepStrictEqual(r0, [{ n: 1, nDeleted: 1, ok: 1 }, { n: 0, nDeleted: 0, ok: 1 }])
        //save之同批重複主鍵(逐筆依序更新, 後者蓋前者)不受影響
        let r1 = await p('save', [{ id: 'secret-r1', name: 'first' }, { id: 'secret-r1', name: 'second' }], { mustExist: true })
        assert.strict.equal(r1.length, 2)
        assert.strict.equal(m.rows('a').find((v) => v.id === 'secret-r1').name, 'second')
    })

    it('M09 事後偵測(表鎖紀律被破壞): 檢查通過後ORM仍回逐筆未命中 → rowNotFound; save看n, del之n與nDeleted任一為0皆算(分別守住)', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }])
        let each = (f) => ([data]) => (Array.isArray(data) ? data : [data]).map(f)
        m.plan.save = each(() => ({ n: 0, nInserted: 0, nModified: 0, ok: 1 }))
        let e1 = await quiet(() => getReject(p('save', [{ id: 'r1', name: 'x' }], { mustExist: true })))
        assert.strict.equal(e1, 'rowNotFound')
        //save: n為1(命中但值未變, nModified為0)不算未命中
        m.plan.save = each(() => ({ n: 1, nInserted: 0, nModified: 0, ok: 1 }))
        assert.deepStrictEqual(await p('save', [{ id: 'r1', name: 'x' }], { mustExist: true }), [{ id: 'r1' }])
        //save: ok為0之逐筆失敗仍走既有之失敗字串(不被誤判為rowNotFound)
        m.plan.save = each(() => ({ n: 0, nInserted: 0, nModified: 0, ok: 0, err: 'boom' }))
        assert.strict.equal(await quiet(() => getReject(p('save', [{ id: 'r1', name: 'x' }], { mustExist: true }))), 'failed to save data: id[r1]')

        //del: n與nDeleted各自為0皆算未命中; 兩者皆為正才算命中; 省略其中一鍵者以另一鍵判定
        for (let [res, expectKey] of [
            [{ n: 0, nDeleted: 0, ok: 1 }, 'rowNotFound'],
            [{ n: 1, nDeleted: 0, ok: 1 }, 'rowNotFound'],
            [{ n: 0, nDeleted: 1, ok: 1 }, 'rowNotFound'],
            [{ nDeleted: 0, ok: 1 }, 'rowNotFound'],
            [{ n: 0, ok: 1 }, 'rowNotFound'],
            [{ n: 1, nDeleted: 1, ok: 1 }, null],
            [{ n: 1, ok: 1 }, null],
            [{ nDeleted: 1, ok: 1 }, null],
        ]) {
            m.plan.del = each(() => res)
            let got = await quiet(() => p('del', [{ id: 'r1' }], { mustExist: true }).then(() => null, (e) => e))
            assert.strict.equal(got, expectKey, JSON.stringify(res))
        }
        //未開啟mustExist時, 同樣之未命中結果不視為錯誤(既有行為)
        m.plan.del = each(() => ({ n: 0, nDeleted: 0, ok: 1 }))
        let r = await p('del', [{ id: 'r1' }])
        assert.deepStrictEqual(r, [{ n: 0, nDeleted: 0, ok: 1 }])
    })

    it('M10 存在檢查之select失敗: reject固定字串(failed to save data、failed to delete data)且零寫入', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }])
        m.reset()
        m.plan.select = () => Promise.reject('db down: secret detail')
        let e1 = await quiet(() => getReject(p('save', [{ id: 'r1', name: 'x' }], { mustExist: true })))
        assert.strict.equal(e1, 'failed to save data')
        let e2 = await quiet(() => getReject(p('del', [{ id: 'r1' }], { mustExist: true })))
        assert.strict.equal(e2, 'failed to delete data')
        assert.strict.equal(m.callsOf('save').length, 0)
        assert.strict.equal(m.callsOf('del').length, 0)
    })

    it('M11 整數主鍵之有限數字與其字串視為同一(R-ID-02), 存在檢查以字串比對', async function() {
        let ds = { a: { keys: KEYS } }
        let m = createMemOrm()
        let so = WServOrm(ds, m.WOrmMem, './unused', 'db')
        await so.procOrm('u', 'a', 'save', [{ id: '123', name: 'A' }])
        m.reset()
        let r = await so.procOrm('u', 'a', 'save', [{ id: 123, name: 'A2' }], { mustExist: true })
        assert.deepStrictEqual(r, [{ id: '123' }])
        assert.strict.equal(m.rows('a')[0].name, 'A2')
        let r2 = await so.procOrm('u', 'a', 'del', [{ id: 123 }], { mustExist: true })
        assert.strict.equal(r2[0].nDeleted, 1)
    })

    it('M11b 整數主鍵表(不轉型): 數字主鍵之存在檢查以字串形式比對, 存在者可修改與刪除, 不存在者rowNotFound', async function() {
        let ds = { a: { keys: KEYS, settings: { id: { pk: true, type: 'INTEGER' } } } }
        let m = createMemOrm()
        let so = WServOrm(ds, m.WOrmMem, './unused', 'db')
        await so.procOrm('u', 'a', 'save', [{ id: 1, name: 'A' }, { id: 2, name: 'B' }])
        assert.deepStrictEqual(m.rows('a').map((v) => v.id), [1, 2], '整數主鍵不轉型')
        m.reset()
        let r = await so.procOrm('u', 'a', 'save', [{ id: 1, name: 'A2' }, { id: 2, name: 'B2' }], { mustExist: true })
        assert.deepStrictEqual(r, [{ id: 1 }, { id: 2 }])
        let e1 = await quiet(() => getReject(so.procOrm('u', 'a', 'save', [{ id: 1, name: 'x' }, { id: 3, name: 'x' }], { mustExist: true })))
        assert.strict.equal(e1, 'rowNotFound')
        let e2 = await quiet(() => getReject(so.procOrm('u', 'a', 'save', [{ name: 'no-id' }], { mustExist: true })))
        assert.strict.equal(e2, 'rowNotFound', '整數主鍵表不補號, 無主鍵視為不存在')
        let e3 = await quiet(() => getReject(so.procOrm('u', 'a', 'del', [{ id: 2 }, { id: 9 }], { mustExist: true })))
        assert.strict.equal(e3, 'rowNotFound')
        assert.deepStrictEqual(m.rows('a').map((v) => v.name), ['A2', 'B2'])
        let r2 = await so.procOrm('u', 'a', 'del', [{ id: 2 }], { mustExist: true })
        assert.strict.equal(r2[0].nDeleted, 1)
    })

    it('M12 opt驗證: 非純物件、未知鍵(含拼錯)、非布林、存取器、symbol鍵 → 固定字串reject, 任何讀寫之前', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }])
        m.reset()
        let acc = {}
        Object.defineProperty(acc, 'mustExist', { get: () => true, enumerable: true })
        let sym = { mustExist: true, [Symbol('x')]: 1 }
        let cases = [
            ['x', 'need an object'], [5, 'need an object'], [[], 'need an object'], [true, 'need an object'], [() => 1, 'need an object'], [new Map(), 'need an object'],
            [{ mustexist: true }, 'unsupported key'], [{ mustExist: true, extra: 1 }, 'unsupported key'], [sym, 'unsupported key'], [{ autoInsert: false }, 'unsupported key'],
            [{ mustExist: 'true' }, 'mustExist needs a boolean'], [{ mustExist: 1 }, 'mustExist needs a boolean'], [{ mustExist: null }, 'mustExist needs a boolean'], [{ mustExist: undefined }, 'mustExist needs a boolean'], [acc, 'mustExist needs a boolean'],
        ]
        for (let [opt, tail] of cases) {
            for (let mode of ['save', 'del']) {
                let input = mode === 'save' ? [{ id: 'new-x', name: 'x' }] : [{ id: 'r1' }]
                let err = await quiet(() => getReject(p(mode, input, opt)))
                assert.strict.equal(err, `invalid opt of procOrm, ${tail}`, `${mode} ${String(opt)}`)
            }
        }
        assert.strict.equal(m.calls.length, 0, '任何ORM呼叫之前即拒收')
        assert.strict.equal(m.rows('a').length, 1)
    })

    it('M12b 無效opt先於擴充函數驗證(外審sol#3): 註冊有副作用之check與前處理時, 無效opt仍固定字串拒收, 擴充函數0次呼叫、ORM 0次呼叫; check拋錯亦不遮蔽固定拒收字串', async function() {
        let { so, m } = mkSo()
        let called = []
        so.addFunCheck(() => {
            called.push('check')
            throw new Error('check would reject first')
        })
        so.addFunPreProcessing(async (x) => {
            called.push('pre')
            await so.woItems.a.save({ id: 'side-effect' })
            return { input: x.input }
        })
        await wait(5)
        m.reset()
        for (let opt of [{ mustExist: 'true' }, { mustexist: true }, 'x', { mustExist: true, extra: 1 }]) {
            let err = await quiet(() => getReject(so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A' }], opt)))
            assert.ok(/^invalid opt of procOrm, /.test(err), String(err))
        }
        let errMode = await quiet(() => getReject(so.procOrm('u', 'a', 'select', {}, { mustExist: true })))
        assert.strict.equal(errMode, 'invalid opt of procOrm, mustExist supports only save and del')
        assert.deepStrictEqual(called, [])
        assert.strict.equal(m.calls.length, 0)
        //有效opt時, check照常先執行(確認上面之0次不是擴充函數壞了)
        let err2 = await quiet(() => getReject(so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A' }], { mustExist: true })))
        assert.strict.equal(err2.message, 'check would reject first')
        assert.deepStrictEqual(called, ['check'])
    })

    it('M13 mustExist:true只適用save與del: insert、select、delAll、mix與無效mode皆reject; mustExist:false於各mode為無效果', async function() {
        let { so, m } = mkSo()
        let p = proc(so)
        await p('save', [{ id: 'r1', name: 'A' }])
        m.reset()
        let inputs = { insert: [{ id: 'i1' }], select: {}, delAll: { id: 'r1' }, mix: { add: [{ id: 'i2' }] }, bogus: [] }
        for (let mode of Object.keys(inputs)) {
            let err = await quiet(() => getReject(p(mode, inputs[mode], { mustExist: true })))
            assert.strict.equal(err, 'invalid opt of procOrm, mustExist supports only save and del', mode)
        }
        assert.strict.equal(m.calls.length, 0)
        assert.deepStrictEqual(await p('select', {}, { mustExist: false }).then((r) => r.map((v) => v.id)), ['r1'])
        assert.deepStrictEqual(await p('insert', [{ id: 'i1' }], { mustExist: false }).then((r) => r), [{ id: 'i1' }])
        assert.deepStrictEqual(await p('mix', { add: [{ id: 'i2' }] }, {}).then((r) => r), [{ id: 'i2' }])
    })

    it('M14 擴充函數(check、前處理、後處理)之參數物件不含opt(形狀不變): 帶mustExist之成功save與del, 三種擴充函數皆被呼叫且鍵集合精確同舊介面', async function() {
        let { so } = mkSo()
        await so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A' }, { id: 'r2', name: 'B' }])
        let seen = []
        so.addFunCheck((x) => {
            seen.push(`check:${Object.keys(x).sort().join(',')}`)
        })
        so.addFunPreProcessing((x) => {
            seen.push(`pre:${Object.keys(x).sort().join(',')}`)
            return { input: x.input }
        })
        so.addFunPostProcessing((x) => {
            seen.push(`post:${Object.keys(x).sort().join(',')}`)
            return x.output
        })
        await wait(5) //擴充函數註冊後約1毫秒生效
        let r = await so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A2' }], { mustExist: true })
        assert.deepStrictEqual(r, [{ id: 'r1' }])
        let r2 = await so.procOrm('u', 'a', 'del', [{ id: 'r2' }], { mustExist: true })
        assert.strict.equal(r2[0].nDeleted, 1)
        let base = 'input,mode,userId,woName'
        let basePost = 'input,mode,output,userId,woName'
        assert.deepStrictEqual(seen, [`check:${base}`, `pre:${base}`, `post:${basePost}`, `check:${base}`, `pre:${base}`, `post:${basePost}`])
    })

    it('M14b 前處理改寫後之input仍被存在檢查(改成不存在之id → rowNotFound, 後處理不執行, 零寫入)', async function() {
        let { so, m } = mkSo()
        await so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A' }])
        let calledPost = 0
        so.addFunPreProcessing((x) => ({ input: x.input.map((v) => ({ ...v, id: 'ghost-by-hook' })) }))
        so.addFunPostProcessing((x) => {
            calledPost++
            return x.output
        })
        await wait(5)
        m.reset()
        let err = await quiet(() => getReject(so.procOrm('u', 'a', 'save', [{ id: 'r1', name: 'A' }], { mustExist: true })))
        assert.strict.equal(err, 'rowNotFound', '前處理改寫後之id不存在')
        assert.strict.equal(calledPost, 0)
        assert.strict.equal(m.callsOf('save').length, 0)
    })

    it('M15 既有四參數呼叫之行為鎖定(以固定預期, 非與自身對照): 各mode之回傳形狀、補主鍵、稽核欄位、XSS清除、拒收字串、ORM收到之實參', async function() {
        let { so, m } = mkSo()
        let p = (mode, input) => so.procOrm('u1', 'a', mode, input)
        //save: 補主鍵並回傳, 稽核欄位補值, 字串依clearXSS清除, ORM之save為單參數呼叫
        let r = await p('save', [{ name: 'x<script>alert(1)</script>y' }])
        assert.strict.equal(r.length, 1)
        assert.ok(typeof r[0].id === 'string' && r[0].id.length > 0, '補主鍵')
        let row = m.rows('a')[0]
        assert.strict.equal(row.id, r[0].id)
        assert.strict.equal(row.userIdUpdate, 'u1')
        assert.ok(typeof row.timeUpdate === 'string' && row.timeUpdate.length > 0)
        assert.ok(row.name.indexOf('<script>') < 0, 'XSS已清除')
        assert.strict.equal(m.callsOf('save').length, 1)
        assert.strict.equal(m.callsOf('save')[0].args.length, 1)
        //insert、select、del、mix、delAll 之回傳形狀
        assert.deepStrictEqual(await p('insert', [{ id: 'i1', name: 'I' }]), [{ id: 'i1' }])
        assert.deepStrictEqual((await p('select', { id: { $in: ['i1'] } })).map((v) => v.id), ['i1'])
        assert.deepStrictEqual(await p('mix', { add: [{ id: 'm1' }], diff: [{ id: 'i1', name: 'I2' }], del: [] }), [{ id: 'm1' }, { id: 'i1' }])
        assert.deepStrictEqual(await p('del', [{ id: 'm1' }]), [{ n: 1, nDeleted: 1, ok: 1 }])
        assert.deepStrictEqual(await p('del', [{ id: 'm1' }]), [{ n: 0, nDeleted: 0, ok: 1 }], '未帶opt之del未命中不視為錯誤(既有行為)')
        let nBefore = m.rows('a').length
        let rd = await p('delAll', {})
        assert.deepStrictEqual(rd, { n: nBefore, nDeleted: nBefore, ok: 1 })
        assert.strict.equal(m.rows('a').length, 0)
        //拒收字串(既有)
        assert.strict.equal(await quiet(() => getReject(p('save', 'not-an-array'))), 'failed to save data, not an object: data[0]')
        assert.strict.equal(await quiet(() => getReject(p('nope', []))), 'invalid mode: nope')
        assert.strict.equal(await quiet(() => getReject(so.procOrm('u1', 'zzz', 'select', {}))), 'can not find table[zzz] in ORM')
        //四參數、第5參數為undefined或null: ORM之save皆為單參數呼叫, 無額外select
        for (let args of [[], [undefined], [null]]) {
            m.reset()
            await so.procOrm('u1', 'a', 'save', [{ id: 'k9', name: 'K' }], ...args)
            assert.strict.equal(m.callsOf('save')[0].args.length, 1)
            assert.strict.equal(m.callsOf('select').length, 0)
        }
    })

})
