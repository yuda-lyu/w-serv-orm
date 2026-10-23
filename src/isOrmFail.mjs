import size from 'lodash-es/size.js'
import getItemsFail from 'w-data-collector/src/getItemsFail.mjs'


/**
 * 判斷ORM寫入類函數(insert、save、del、delAll)之回傳結果是否回報失敗
 *
 * 依w-orm系列規格，insert與delAll回傳聚合物件且ok恆為1，save與del回傳逐筆陣列，錯誤皆整批reject；單筆失敗者(save、del)於該筆以ok為0回報。
 * 本函數不論函數與形狀一律判讀：回傳為聚合物件(非null、非陣列之物件)而ok為0者(ORM違約或他種後端)視為失敗；
 * 回傳為逐筆陣列而任一筆ok為0者(同getItemsFail之判讀)視為失敗。
 * 其餘(undefined、null、無ok鍵之物件、空陣列、元素皆ok非0或非物件之陣列、ok為1含略過既有主鍵或未命中之n為0)不視為失敗，維持舊行為。
 * 讀取函數(select)之回傳為數據列，列內欄位可能名為ok，不得以本函數判讀。
 * 供procOrm之寫入類各模式、mix之各步驟、備份還原與測試數據寫入共用。
 *
 * @param {*} r 輸入ORM寫入類函數之回傳結果
 * @returns {Boolean} 回傳是否回報失敗
 */
function isOrmFail(r) {

    //check, 逐筆陣列
    if (Array.isArray(r)) {
        return size(getItemsFail(r, [])) > 0
    }

    //check, 聚合物件
    return r !== null && typeof r === 'object' && r.ok === 0
}


export default isOrmFail
