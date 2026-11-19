# Command line

`node bin/orders.mjs <command> ...`. A stock file is a JSON object from SKU to available quantity, for example `{"apple": 5, "pear": 3}`. Every error is one line on standard error, ends the command with exit code 2 and writes nothing.

## available

`orders available <stock-file> --sku <sku>` prints the available quantity of one SKU on its own line.

- No stock file: `orders available: a stock file is required`
- No `--sku`: `orders available: --sku is required`
- An unknown SKU: `orders available: unknown SKU <sku>`

## export

`orders export <stock-file> --out-dir <directory>` writes `stock.csv` into the directory, creating the directory and its parents when they do not exist, and prints `wrote <directory>/stock.csv` on its own line. `--out-dir=<directory>` is the same flag. `npm run export-stock -- <stock-file> --out-dir <directory>` runs it.

`stock.csv` starts with the header line `sku,available,reserved`, then one line per SKU in ascending SKU order, each `<sku>,<available>,<reserved>`. Lines end with `\n`, the last one included.

- No stock file: `orders export: a stock file is required`
- No `--out-dir`: `orders export: --out-dir is required`

The stock file is checked first. The CSV comes from `stockCsv(stock)` in `src/stock-export.mjs`, and the file is written by `writeStockExport(stock, { outDir })` in the same module, which returns the written file's path.
