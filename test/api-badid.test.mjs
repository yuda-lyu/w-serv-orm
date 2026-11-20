import fs from 'fs'
import assert from 'assert'
import WOrm from 'w-orm-lowdb/src/WOrmLowdb.mjs'
import ds from '../schema/index.mjs'
import WServOrm from '../src/WServOrm.mjs'
import { getReject, quiet } from './tools/ormStub.mjs'
import { BAD, ENTRIES } from './tools/badIds.mjs'


//規格: 第568項(與w-orm-*全族第557項規則一對齊); 規則帳本 R-ID-01 規則 5; dspec〈輸入參數之檢測機制〉V19、V20、§11 W-20
//以真w-orm-lowdb(>= 1.0.72, 主鍵固定為字串id, 對「給了而非字串」之主鍵直呼即拒絕)經procOrm驗證: 被拒者表內容不變(含同批之有效列)
//替身ORM之細部案見 unit-badid.test.mjs
//
//規格句對照:
//  C01 規則5「給了而無效之主鍵(型別全集)於四個寫入入口整批reject, 不寫入任何一筆(含同批之有效列與未帶列)」
//  C02 規則5「true、{}、[]等可經JSON送達之值亦然」(通道解碼為JSON之產物)
//  C03 預言機: 本層拒絕者, 直呼後端亦拒絕(全族規則一, 後端 >= 1.0.72); 本層不再比後端寬鬆
//  C04 規則1「未帶與有效主鍵照既有處理」(補主鍵、有限數字轉字串)
//  C05 §11 W-20「包裝物件不被拆成原始值寫入」
//  C06 規則5「刪除通道不變」: 無效主鍵之刪除由後端逐筆ok:0, 本層既有格式reject, 表內容不變

let fd = './test/_tmp/api-badid'

describe('第568項: 主鍵給了而無效, 經真w-orm-lowdb整批拒絕且表內容不變(R-ID-01 規則5)', function() {

    let so = null
    let rows = async () => (await so.woItems.tests.select()).map((v) => [v.id, v.name])
    let seed = [['seed1', 's1']]

    before(function() {
        fs.rmSync(fd, { recursive: true, force: true })
        fs.mkdirSync(fd, { recursive: true })
        so = WServOrm(ds, WOrm, `${fd}/db.json`, 'worm')
    })

    beforeEach(async function() {
        await so.woItems.tests.delAll()
        await so.woItems.tests.insert([{ id: 'seed1', name: 's1' }])
    })

    after(async function() {
        await so.closeAll()
        fs.rmSync(fd, { recursive: true, force: true })
    })

    it('C01 四個寫入入口 x 給了而無效之各型別: reject, 同批有效列與未帶列皆不寫入, 表內容不變', async function() {
        //規則5: 批次[有效, 無效, 未帶]; 修前會把無效者與未帶者補新主鍵寫入
        for (let en of ENTRIES) {
            for (let [label, mk] of BAD) {
                let input = [{ id: 'v1', name: 'n0' }, { id: mk(), name: 'n1' }, { name: 'n2' }]
                let err = await quiet(() => getReject(en.run(so, input)))
                assert.strictEqual(err, `${en.msg}, invalid id: data[1]`, `${en.name} ${label}`)
                assert.deepStrictEqual(await rows(), seed, `${en.name} ${label}: 表內容不變`)
            }
        }
    })

    it('C02 可經JSON送達之值(true、false、{}、[]、{"a":1}、[1])亦拒絕', async function() {
        //規則5: 資料通道之請求為JSON, 解碼後之id為一般物件、陣列與布林
        for (let en of ENTRIES) {
            for (let text of ['true', 'false', '{}', '[]', '{"a":1}', '[1]', '[[]]', '{"id":"x"}']) {
                let input = JSON.parse(`[{"name":"j0","id":${text}}]`)
                let err = await quiet(() => getReject(en.run(so, input)))
                assert.strictEqual(err, `${en.msg}, invalid id: data[0]`, `${en.name} ${text}`)
                assert.deepStrictEqual(await rows(), seed, `${en.name} ${text}`)
            }
        }
    })

    it('C03 預言機: 本層拒絕之每個型別, 直呼後端(woItems)亦拒絕(insert reject、save該筆ok:0), 本層不比後端寬鬆', async function() {
        //全族規則一(後端 >= 1.0.72): 給了而非字串即拒絕; 後端契約再變動時本案轉紅, 提示重審本層規則
        for (let [label, mk] of BAD) {
            let ei = await quiet(() => getReject(so.woItems.tests.insert([{ id: mk(), name: 'd0' }])))
            assert.ok(/invalid id/.test(String(ei)), `insert ${label}: ${ei}`)
            let rs = await quiet(() => so.woItems.tests.save([{ id: mk(), name: 'd1' }]))
            assert.strictEqual(rs[0].ok, 0, `save ${label}`)
            assert.ok(/invalid id/.test(String(rs[0].err)), `save ${label}: ${rs[0].err}`)
            assert.deepStrictEqual(await rows(), seed, `直呼 ${label}`)
        }
    })

    it('C04 未帶(undefined、null、空字串、鍵不存在)補主鍵寫入, 有限數字轉字串, 非空字串原樣; 回報與表內一致', async function() {
        //規則1、R-ID-02: 既有行為不變
        let input = [
            { name: 'a0' },
            { id: null, name: 'a1' },
            { id: '', name: 'a2' },
            { id: undefined, name: 'a3' },
            { id: 5, name: 'a4' },
            { id: 'keep', name: 'a5' },
            { id: ' ', name: 'a6' },
        ]
        let r = await so.procOrm('u1', 'tests', 'insert', input)
        let rs = await rows()
        assert.strictEqual(rs.length, 1 + input.length)
        let byName = Object.fromEntries(rs.map(([id, name]) => [name, id]))
        assert.deepStrictEqual([byName.a4, byName.a5, byName.a6], ['5', 'keep', ' '])
        assert.ok(['a0', 'a1', 'a2', 'a3'].every((n) => byName[n].length > 30))
        assert.strictEqual(new Set(['a0', 'a1', 'a2', 'a3'].map((n) => byName[n])).size, 4)
        assert.deepStrictEqual(r.map((v) => v.id), ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map((n) => byName[n]))
    })

    it('C05 包裝物件不被拆成原始值寫入: new String(\'a\')被拒而表內無\'a\'', async function() {
        //W-20; 修前 insert、save、mix 皆把它寫成主鍵 'a'(複製階段拆包)
        for (let en of ENTRIES) {
            let err = await quiet(() => getReject(en.run(so, [{ id: new String('a'), name: 'w0' }]))) // eslint-disable-line no-new-wrappers
            assert.strictEqual(err, `${en.msg}, invalid id: data[0]`, en.name)
            assert.strictEqual((await so.woItems.tests.select({ id: 'a' })).length, 0, en.name)
        }
        assert.deepStrictEqual(await rows(), seed)
    })

    it('C06 刪除通道不變: 無效主鍵之del與mix.del由後端逐筆ok:0, 本層以既有格式reject, 表內容不變', async function() {
        //規則5: del不補主鍵; 此為核實不改(全族規則一第4點「刪查入口已拒絕者核實不改」)
        for (let [label, mk] of BAD) {
            let e1 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'del', [{ id: mk() }])))
            assert.ok(/^failed to delete data: (data\[0\]|id\[-?Infinity\])$/.test(e1), `del ${label}: ${e1}`)
            let e2 = await quiet(() => getReject(so.procOrm('u1', 'tests', 'mix', { del: [{ id: mk() }] })))
            assert.ok(/^failed to delete data: (data\[0\]|id\[-?Infinity\])$/.test(e2), `mix.del ${label}: ${e2}`)
            assert.deepStrictEqual(await rows(), seed, label)
        }
    })

})
