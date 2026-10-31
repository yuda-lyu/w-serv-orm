import get from 'lodash-es/get.js'


/**
 * 檢查opt是否帶有本套件已移除之設定(公開子模組，見README〈公開子模組〉)
 *
 * 供使用端包裝層(如w-web-*)於建構自身之前，預先檢查自身之opt；判準與訊息之單一擁有者為本套件，WServOrm之建構與getProc亦呼叫本函數。
 * 同步；只看useCheckUser、getUserById、useExcludeWhenNotAdmin三鍵，值為undefined、null、false者通過並回傳undefined，其他值拋Error，訊息起首為`opt.<鍵> has been removed, `(其後之提示句不屬穩定承諾)；多鍵違規時依上述三鍵之序報第一個；opt未給、為null或非物件者通過；不改動opt，opt之其他鍵不受影響。
 * 受檢鍵之增減列入README〈Breaking changes〉。
 *
 * @param {Object} [opt] 輸入設定物件
 * @returns {undefined} 通過時回傳undefined
 * @throws {Error} 三鍵之一給予undefined、null、false以外之值時
 * @example
 *
 * import checkOptRemoved from 'w-serv-orm/src/checkOptRemoved.mjs'
 *
 * checkOptRemoved({ useCheckUser: false, serverPort: 11005 }) //通過
 * checkOptRemoved({ useCheckUser: true }) //拋Error: opt.useCheckUser has been removed, ...
 *
 */
function checkOptRemoved(opt) {
    //已移除之設定: 未給、null或false者接受(使用端現行之設定), 其餘值拋錯, 避免使用端以為仍有檢查而無聲失去
    //useCheckUser只查使用者存在且有效, 屬認證而非授權, 卻曾被當成授權; procOrm不做授權, 須由procOrm開放給前端之處負責
    //useExcludeWhenNotAdmin依賴只有useCheckUser才產生之isAdmin, 未開useCheckUser時會把所有人當非管理者過濾, 一併移除
    //收opt之進入點(WServOrm、getProc)皆須呼叫, 直接呼叫getProc者亦不得靜默忽略
    //使用端包裝層可直接呼叫以檢查其自身之opt, 只看這三鍵, opt之其他鍵不受影響, 通過時回傳undefined
    let msgAuth = 'procOrm does not authorize users, authorize where procOrm is exposed to clients'
    let ks = [
        ['useCheckUser', msgAuth],
        ['getUserById', msgAuth],
        ['useExcludeWhenNotAdmin', 'procOrm does not filter select results by user, use addFunPostProcessing if needed'],
    ]
    for (let [k, hint] of ks) {
        let v = get(opt, k)
        if (v !== undefined && v !== null && v !== false) {
            throw new Error(`opt.${k} has been removed, ${hint}`)
        }
    }
}


export default checkOptRemoved
