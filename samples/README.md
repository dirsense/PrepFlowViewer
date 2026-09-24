# Tableau Prep 複雑なフローのサンプル

最初の3件は、公開されている Preppin' Data のフロー27件を比較し、ステップ数と計算式の多いものを選びました。元ファイルの内容は変更していません。すべて入力データを含む `.tflx` です。

| ファイル | ステップ数 | 計算式数 | 主な内容 |
| --- | ---: | ---: | --- |
| `03_PreppinData_2019_Week_21.tflx` | 27 | 10 | 患者・入院日・費用の処理。入力5、結合3、ユニオン2、集計2、出力2。日付の展開と入れ子の DATEADD。フロー構造を見るならこれがおすすめ。 |
| `02_Preppin_Data_2019_Week_13.tflx` | 21 | 16 | 口座残高・取引の処理。週・月・四半期への分岐、集計3、出力3。IF、DATEPART、DATETRUNC、MAKEDATE、ROUND。 |
| `01_Preppin_Data_2019_Week_9.tflx` | 14 | 27 | 苦情テキストの単語分解・整形。SPLIT、TRIM、REGEXP_REPLACE、ピボット2、結合1。計算式27件のうち21件は単語位置を変えた Tweet の分割。 |

## 開き方

Tableau Prep Builder で `.tflx` を開いてください。実行する場合は、各出力ステップの保存先を自分のフォルダに変更してください。元ファイルには作者のPCの出力パスが残っています。

上記3件は2019年のフローです。ZIPの整合性、内部JSON、ステップ間の参照、入力データの同梱を確認済みです。Tableau Prep Builder 上での開封・実行は未検証です。

ステップ数はフロー図に対応する最上位ノード数で、入力・出力を含みます。計算式数は内部の expression 定義数で、自動分割・クイッククリーニングによる計算も含みます。

## 出典

- 作者の公開リポジトリ: https://github.com/nicholsonjb/PreppinData
- Week 21: https://github.com/nicholsonjb/PreppinData/tree/master/Week%2021
- Week 13: https://github.com/nicholsonjb/PreppinData/tree/master/Week%2013
- Week 9: https://github.com/nicholsonjb/PreppinData/tree/master/Week%209

取得日: 2026-09-17。各ダウンロードURLと集計値は `sources.json` に記録しています。

## 追加サンプル（2026-09-18）

Preppin’ Data公式解説（Tom Prowse）の配布フローを10件追加しました。元ファイルは変更していません。既存ファイルも含め、現在samplesには15件あります。ビューアー上部のファイル選択から切り替えられます。

| ファイル | ステップ数 | 計算式数 | 見どころ | 出典 |
| --- | ---: | ---: | --- | --- |
| [PreppinData_2024_Week_05.tflx](PreppinData_2024_Week_05.tflx) | 19 | 3 | 複数条件を含む結合4、3方向の出力 | [公式解説](https://preppindata.blogspot.com/2024/02/2024-week-5-solution.html) |
| [PreppinData_2024_Week_08.tflx](PreppinData_2024_Week_08.tflx) | 18 | 15 | 不等号での結合、特典の文字列分割、ピボット、集計 | [公式解説](https://preppindata.blogspot.com/2024/02/2024-week-8-solution.html) |
| [PreppinData_2024_Week_18.tflx](PreppinData_2024_Week_18.tflx) | 38 | 25 | 入力6、結合4、ユニオン、集計2、ピボット、出力2 | [公式解説](https://preppindata.blogspot.com/2024/05/2024-week-18-solution.html) |
| [PreppinData_2024_Week_21.tflx](PreppinData_2024_Week_21.tflx) | 8 | 5 | 顧客区分、集計、行→列ピボット、構成比 | [公式解説](https://preppindata.blogspot.com/2024/05/2024-week-21-solution.html) |
| [PreppinData_2024_Week_27.tflx](PreppinData_2024_Week_27.tflx) | 15 | 11 | ステージ情報の結合3、文字列・条件分岐の計算 | [公式解説](https://preppindata.blogspot.com/2024/07/2024-week-27-solution.html) |
| [PreppinData_2024_Week_31.tflx](PreppinData_2024_Week_31.tflx) | 13 | 12 | 列→行と行→列のピボット、文字列整形、順位計算 | [公式解説](https://preppindata.blogspot.com/2024/08/2024-week-31-solution.html) |
| [PreppinData_2024_Week_34.tflx](PreppinData_2024_Week_34.tflx) | 16 | 15 | 日付調整、休日判定、FIXED LOD、フィルター | [公式解説](https://preppindata.blogspot.com/2024/08/2024-week-34-solution.html) |
| [PreppinData_2024_Week_42.tflx](PreppinData_2024_Week_42.tflx) | 16 | 27 | 音楽情報の文字列分割・置換、列→行ピボット | [公式解説](https://preppindata.blogspot.com/2024/10/2024-week-42-solution.html) |
| [PreppinData_2023_Week_15.tflx](PreppinData_2023_Week_15.tflx) | 19 | 8 | 日付の組み合わせ、順位計算、ピボット3、結合2 | [公式解説](https://preppindata.blogspot.com/2023/04/2023-week-15-solution.html) |
| [PreppinData_2023_Week_28.tflx](PreppinData_2023_Week_28.tflx) | 12 | 2 | 順位計算、入力3、結合2 | [公式解説](https://preppindata.blogspot.com/2023/07/2023-week-28-solution.html) |

追加分の計算式数はビューアーの解析値です。ZIPの整合性と全10件の定義読み込みを確認しました。実データへの接続、Tableau Prepでの実行は行っていません。新しい加工や、値によって列が決まる行→列ピボットなどのフィールド復元には、ビューアーの既存の制限があります。公開用に提供されている練習フローで、元の出力パス等はそのまま残しています。配布リンク・取得日・SHA-256はsources.jsonに記録しています。
