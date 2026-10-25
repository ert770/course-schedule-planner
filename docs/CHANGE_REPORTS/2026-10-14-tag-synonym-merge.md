# rag_tag 同義詞合併（標籤目錄 v3）

- 日期：2026-10-14
- 前一步：[標籤向量降權套用與同義詞合併候選](./2026-10-14-tag-downweights-and-synonym-candidates.md)
- 審核：使用者審核 `2026-10-14-tag-synonym-candidates.xlsx`——「建議合併」424 列全部同意，「需人工判斷」60 列全部選「合併」，標準標籤沒有改動。
- 性質：**正式路徑的改動**。標籤目錄改版會影響標籤興趣檔 `s_tag`（排課的標籤興趣排序、興趣探索）與標籤向量 `s_vec`（探索頁）。

---

## 1. 結論

1. **484 組核准配對合成 406 個群組，480 個標籤併入標準標籤。** 標準標籤從 6,769 個減為 6,289 個，
   別名從 13 組增為 493 組。目錄版本 `rag-tag-catalog-2026-10-09-v2` → `rag-tag-catalog-2026-10-14-v3`。
2. **106 個原本只出現在一門課的標籤，合併後可以跨課比對**（例：3D設計、SQL Server、人機介面、中小企業）。
3. **「統計學」併入「統計」後出現在 46 門課（超過 2%），改判為常見主題**，從 `s_tag` 的興趣學習中排除；
   在標籤向量中仍以低權重保留（同機器學習、人工智慧）。
4. 效果（真實帳號 D1249697）：
   - `s_tag` 有分數的非必修候選課從 24.8% 提高到 26.7%。
   - `s_vec` 涵蓋率從 81.4% 提高到 83.1%。
   - 留一驗證 0.764 → 0.751，屬於小幅波動。
5. 舊事件快照中被合併掉的標籤 ID，改為依名稱對應到目前的標準標籤，使用者的互動證據不會流失。
   真實帳號 30 筆有快照的事件中有 5 筆受影響（資安、資訊技術、可再生能源等）。

---

## 2. 流程

完全沿用 2026-10-08 13 組語意別名的機制，只是規模較大：

| 步驟 | 腳本 | 說明 |
| --- | --- | --- |
| 1 | `server/scripts/lib/readSynonymDecisions.py`（新增） | 讀審核活頁簿，空白決定等於同意「建議」欄；「需人工判斷」頁必須有明確決定 |
| 2 | `server/scripts/applyTagSynonyms.js`（新增） | 聯集合併成群組；群組內出現課數最多的當標準標籤（與候選清單同一規則）；被併入標籤的名稱與所有原始寫法都寫成別名；既有別名若指向被併入的標籤會改指新標準標籤（這次 0 筆） |
| 3 | `server/scripts/importInterestTagCatalog.py` | 版本改為 `rag-tag-catalog-2026-10-14-v3`，重建目錄。標籤 ID 由標準名稱決定，所以標準標籤 ID 不變，只有被併入的 480 個 ID 消失，沒有新 ID |
| 4 | `server/scripts/recountInterestTagEligibility.js`（新增） | 依當學期課程重算資格並寫回目錄。規則就是既有的 `buildInterestTagEligibility()`；**先用舊目錄驗證過：同規則重算的結果與舊目錄存的資格完全一致（6,769 個標籤 0 個不同）** |
| 5 | 降權名單 | 移除 34 個被併入的 ID（剩 374 個）；合併後的標籤沿用標準標籤自己的狀態（使用者規則：課數較多一方） |
| 6 | `server/scripts/tagEmbeddingStage2.js` | 以新目錄重算標籤相近表（只用名稱、`text-embedding-3-large`、門檻 0.70；embedding 全部來自快取，未呼叫 API） |

`eligibilityRecount.courseMembershipSha256` 改為「`buildInterestTagEligibility()` 回傳的 `courses` JSON 的 SHA-256」。
2026-10-09 舊快照的雜湊算法沒有留下紀錄，兩者不能互相比較；它只用來辨識資格是依哪一份課程資料算的。

---

## 3. 目錄前後比較

| 項目 | v2（合併前） | v3（合併後） |
| --- | --- | --- |
| 標準標籤 | 6,769 | 6,289 |
| 核准別名 | 13 | 493 |
| 可學習興趣 | 6,736 | 6,255 |
| 可跨課比對 | 2,144 | 2,121 |
| 常見主題（too_common） | 27 | 28（新增「統計學」） |
| 只出現在一門課 | 4,592 | 4,134 |
| 向量標籤（可跨課 ＋ 常見主題） | 2,171 | 2,149 |
| 標籤相近表 | 1,383 個標籤、3,583 組 | 1,292 個標籤、3,169 組 |

可跨課比對的數量變少，是因為原本兩個可比對的同義標籤合成一個；相近表變小，是因為原本互為相近的同義標籤已經是同一個標籤。

資格狀態改變的 107 個標籤：106 個「單課 → 可跨課比對」、1 個「可跨課比對 → 常見主題」（統計學，33 → 46 門課）。

最大的群組（6 個標籤）：智慧交通 ← 智慧運輸、智慧型運輸系統、智能交通、智能交通系統、智慧運輸系統。

---

## 4. 程式改動

### 4.1 `server/src/skills/tagInterestLearning.js`：舊事件快照的標籤 ID 對應

事件快照保存的是事件當時的標籤 ID。新增 `currentSnapshot()`：快照中的 ID 若已不在目前目錄，依快照裡的標籤名稱
解析到目前的標準標籤（同一事件中多個舊 ID 對應到同一個新 ID 時合併）。**目前目錄仍有的 ID 完全不動**，
所以沒有合併的情況下行為與先前相同。標籤興趣檔與使用者向量都透過 `collectWeightedTagInterestEvents()` 取得對應後的快照。

### 4.2 資料檔

- `server/src/data/interestTagAliases.json`：493 組別名，另記錄 `reviewedSynonymMerge`（審核日期、來源、群組數）。
- `server/src/data/interestTagCatalog.json`：v3 目錄與 `rag-tag-eligibility-2026-10-14-v1` 資格。
- `server/src/data/tagVectorDownweights.json`：374 個標籤，`catalogVersion` 更新。
- `server/src/data/tagVectorNeighbors.json`：以 v3 目錄重算。

### 4.3 測試

- `interestTagCatalog.test.js`：更新目錄版本、別名數、資格統計與「AI」課數（97 → 99，併入「人工智能」）；
  新增「人工智能 → 人工智慧」走核准別名的檢查。
- `tagInterestLearning.test.js` 新增 TIL-MERGE：快照中已被合併的標籤 ID 依名稱對應到目前的標準標籤。
- TV5、TV6 自動檢查相近表與降權名單的目錄版本一致。

---

## 5. 驗證

- `server/src` 全部 `node --check` 通過；`npm test` 1,522 項，1,521 通過、1 略過、0 失敗。
- **瀏覽器（D1249697，使用者自行登入；重啟後端以載入新目錄）**：
  - 探索頁「依你的修課與興趣」：「AI與機器翻譯」的理由從合併前的「人工智慧（近似你的『人工智能』）」
    變成直接比對到的「人工智慧」；通識最後一門由「卓越領導力」換成主題為互動設計、批判性思維的課。
  - 興趣探索頁正常載入 8 張卡片。相關 API 都是 200。
- **未在瀏覽器驗到**：排課主頁「產生課表」。它用 `s_tag` 排序，但產生課表會寫入曝光事件到共用資料庫，
  這次沒有操作；`s_tag` 的變化以第 1 節第 4 點的離線量測與測試涵蓋。需要的話請你在畫面上產生一次課表確認。

---

## 6. 影響與注意事項

- **已存的標籤興趣快取**：`Learned_Tag_Interests` 的目錄版本與 v3 不符，下次讀取時會依既有機制重算（不需要手動處理）。
- **106 個新的向量標籤沒有經過降權審核**：它們原本只出現在一門課，不在 2026-10-14 的形式標籤審核範圍內。
  其中可能有形式或泛用詞（例如「Social Science」）。需要的話可以用 `formalTagClassify.js` 對這批補做分類與審核。
- 「統計學」改為常見主題後，選「統計學」為興趣的使用者在 `s_tag` 中不再得到這個標籤的分數（`s_vec` 仍有）。
  這是既有 2% 門檻規則的結果，若要例外處理需要另外決定。
- 驗收環境的兩個問題（`launch.json` 埠號與前端代理不一致、設定完成標記存在瀏覽器）見
  [階段 4 報告](./2026-10-14-explore-by-profile-stage4.md) 3.1，這次沿用相同的暫時處理，未修改程式。

---

## 7. 本次異動

| 檔案 | 異動 |
| --- | --- |
| `server/scripts/lib/readSynonymDecisions.py` | 新增 |
| `server/scripts/applyTagSynonyms.js` | 新增 |
| `server/scripts/recountInterestTagEligibility.js` | 新增 |
| `server/scripts/importInterestTagCatalog.py` | 目錄版本改為 v3 |
| `server/src/data/interestTagAliases.json`、`interestTagCatalog.json`、`tagVectorDownweights.json`、`tagVectorNeighbors.json` | 見 4.2 |
| `server/src/skills/tagInterestLearning.js` | 舊事件快照標籤 ID 對應 |
| `server/test/interestTagCatalog.test.js`、`tagInterestLearning.test.js` | 見 4.3 |
| `docs/CHANGE_REPORTS/2026-10-14-tag-synonym-merge.md` | 新增：本報告 |
| `docs/CHANGE_REPORTS/README.md`、roadmap | 索引與 #43、#6 |

- 外部 API：無（embedding 全部來自快取）。對資料庫只讀課程與事件，未寫入。
- 未 commit。

---

## 8. 追加：106 個新向量標籤的降權審核（2026-10-14）

- 使用者審核 `2026-10-14-formal-tag-candidates-v3-new.xlsx`：14 個降權（報告技巧、互聯網、文獻搜集、任務型教學、
  個人化學習、專題式學習、產業經驗、產業實務、設計技能、Social Science，以及改判的物理模式、教學法、透明性、環保意識）；
  SQL Server、InDesign 未填，依表格預設保留。
- 降權名單 374 → 388 個。新增 `server/scripts/lib/readFormalTagDecisions.py`（讀審核表）；`formalTagClassify.js` 新增
  `--reviewed`（只分類未審核的標籤）與 `--xlsx`（輸出檔名）。
- 影響：真實帳號留一驗證維持 0.751、前 10 名不變；Persona 變動在 ±0.004 內。重啟後端後探索頁正常。
- 相關測試 36 項通過；未 commit。
