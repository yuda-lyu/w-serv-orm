import assert from 'assert'
import isOrmFail from '../src/isOrmFail.mjs'


//R-ORM-RESULT-01(原R-PERITEM-01 規則4, orm-run03、run04): ORM寫入類函數之回傳結果是否回報失敗之判準; procOrm各寫入模式與mix各步驟、備份還原、測試數據寫入共用
describe('isOrmFail', function() {

    it('V01 聚合物件ok為0為失敗', function() {
        //規則: 聚合物件ok恆等於0(違約之ORM或他種後端)
        for (let r of [{ n: 2, nInserted: 0, ok: 0 }, { n: 2, nInserted: 1, ok: 0, err: 'E' }, { n: 0, nDeleted: 0, ok: 0 }, { ok: 0 }]) {
            assert.strict.equal(isOrmFail(r), true, JSON.stringify(r))
        }
    })

    it('V02 逐筆陣列任一筆ok為0為失敗', function() {
        //規則(run04): 同getItemsFail之判讀(僅ok恆等於0者)
        for (let r of [[{ ok: 0 }], [{ ok: 1 }, { ok: 0 }], [{ ok: 1 }, null, { ok: 0, err: 'E' }], [1, 'x', { ok: 0 }]]) {
            assert.strict.equal(isOrmFail(r), true, JSON.stringify(r))
        }
    })

    it('V03 其餘回傳形狀不是失敗(維持舊行為)', function() {
        //規則: 略過既有主鍵或未命中(n為0、ok為1)為正常結果; ok非恆等於0(含false、'0'、null、undefined)與非物件、非陣列者不判
        let cases = [
            { n: 2, nInserted: 2, ok: 1 }, { n: 0, nInserted: 0, ok: 1 }, { n: 0, nDeleted: 0, ok: 1 }, {}, { n: 1 },
            { ok: false }, { ok: '0' }, { ok: null }, { ok: undefined },
            [], [{ ok: 1 }], [{ n: 1 }], [null, 1, 'x', {}], [{ ok: false }, { ok: '0' }],
            undefined, null, 0, 1, '', 'x', true, false,
        ]
        for (let r of cases) {
            assert.strict.equal(isOrmFail(r), false, JSON.stringify(r) + ' ' + typeof r)
        }
    })

})
