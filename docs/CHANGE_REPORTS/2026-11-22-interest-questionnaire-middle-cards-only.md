# 課程興趣問答只在中沙漏顯示方向卡

修改日期：2026-11-22

- `client/src/components/Profile/InterestQuestionnaire.jsx`：恢復本系、通識、系外的 A／B／C 多選方向題，保留換一組、上一題與略過。選完按「下一題」才出現中沙漏的長方形卡，且僅出現這一組已選且有候選標籤的方向。點卡進入原有的具體標籤短題，完成返回中沙漏，最後以原確認頁儲存。
- `server/src/services/interestQuestionnaireService.js`：大沙漏恢復每批至多三個選項。中沙漏的 `stage=detail` 由 `layout=cards` 取得每批最多四張的分頁，重疊方向分開但仍可在後續批次開啟；各卡以最多兩個代表標籤說明內容。具體標籤問答仍使用 `stage=card`。
- `server/test/interestQuestionnaireService.test.js`、`docs/API_SPEC.md`、`docs/PROMPT_DESIGN.md`、`docs/TEST_PLAN.md` 更新入口與回歸驗證；上一份卡片報告加上修訂連結。既有保存格式、標籤資格與推薦計分沿用。

## 驗證

- Chrome 同帳號對照修改前的四格開場，修正後本系開場為 3 個 A／B／C 選項且 0 張方向卡。點「下一題」後才顯示 4 張 370 × 112px 長方形，更多已選方向可分頁查看。點 AI 卡取得具體標籤題，勾選「機器學習」後回中沙漏仍顯示已選。略過通識及系外後，原確認頁保留已勾選的「機器學習」。未送出偏好設定，主控台未見錯誤或警告。
- `CI=true npm run verify` 通過，前端 lint、build 與後端 1,779 項測試通過、1 項略過。後端語法與 `git diff --check` 通過。

本次未提交或推送。
