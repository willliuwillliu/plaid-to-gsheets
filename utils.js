const onOpen = () => {
  ui.createMenu("Plaid API Ingest")
    .addItem("Import Latest Transactions", "importLatest")
    .addItem("Import Date Range", "importByDateRange")
    .addItem("Set up", "setUp")
    .addToUi();
};

/**
 * Updates transactions so that the schema matches the sheet. Converts from array of objects to 2D array.
 * Removes existing transactions
 * Removes pending transactions
 * @param {*} transactions
 * @param {*} owner
 * @param {*} account
 * @returns
 */
const cleanTransactions = (transactions, accounts, owner, account) => {
  const transactionIds = getTransactionIds("L");
  let result = [];
  transactions.forEach((transaction) => {
    let account_id = transaction.account_id;
    let mask = accounts[account_id].mask;
    let merchantName =
      transaction.merchant_name != null
        ? transaction.merchant_name
        : transaction.name;

    // Filter out pending transactions
    if (transaction.pending === true) {
      return;
    }

    // Filter out existing transactions
    if (transactionIds.includes(transaction.transaction_id)) {
      return;
    }

    const PlaidCat1 = transaction.category[0] ? transaction.category[0] : "";
    const PlaidCat2 = transaction.category[1] ? transaction.category[1] : "";
    const PlaidCat3 = transaction.category[2] ? transaction.category[2] : "";
    const updatedTransaction = {
      Rollup: "Rollup",
      Date: transaction.date,
      Name: transaction.name,
      "Marchant Name": merchantName,
      "Payment Channel": transaction.payment_channel,
      "ISO Currency Code": transaction.iso_currency_code,
      "Plaid Category 1": PlaidCat1,
      "Plaid Category 2": PlaidCat2,
      "Plaid Category 3": PlaidCat3,
      "Category ID": transaction.category_id,
      "Transaction Type": transaction.transaction_type,
      "Transaction ID": transaction.transaction_id,
      Owner: owner,
      Account: account,
      Mask: mask,
      "Account Name": accounts[account_id].name,
      "Account Type": accounts[account_id].type,
      "Account Subtype": accounts[account_id].subtype,
      Address: transaction.location.address,
      City: transaction.location.city,
      Region: transaction.location.region,
      "Postal Code": transaction.location.postal_code,
      Country: transaction.location.country,
      "Store Number": transaction.location.store_number,
      Category: PlaidCat1,
      Amount: transaction.amount,
    };
    result.push(updatedTransaction);
  });
  return result;
};

const transformTransactions = (transactions, includeHeaders) => {
  let transformedTransactions = applyRulesToData(transactions);
  // Turn ruled data back into a 2D array
  transformedTransactions = transformedTransactions.map((row) =>
    Object.keys(row).map((key) => row[key])
  );
  // If includeHeaders is true, add the headers to the top of the array
  if (includeHeaders && transactions[0]) {
    transformedTransactions.unshift(
      Object.keys(transactions[0]).map((key) => key)
    );
  }
  return transformedTransactions;
};

const writeDataToBottomOfTab = (tabName, data, clearTab) => {
  if (data.length === 0) {
    console.log("No data to write");
    return;
  }

  let writeSS = SpreadsheetApp.getActiveSpreadsheet();
  let writesheet = writeSS.setActiveSheet(writeSS.getSheetByName(tabName));

  if (clearTab) {
    writesheet.clear();
  }
  const lastRow = writesheet.getLastRow() + 1;
  const lastColumn = writesheet.getLastColumn() + 1;
  const rows = data.length;
  const cols = data[1].length;
  const writeResult = writesheet
    .getRange(lastRow, 1, rows, cols)
    .setValues(data);
  SpreadsheetApp.flush();
  return writeResult;
};

/**
 * Left aligns all cells in the spreadsheet and sorts by date
 */
const cleanup = (sheetName, dateColumnPosition) => {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).activate();
  sheet.getActiveRangeList().setHorizontalAlignment("left");
  sheet.sort(dateColumnPosition, false);
  console.log(`${sheetName} has been cleaned up`);
};

/**
 * Returns the date in a Plaid friendly format, e.g. YYYY-MM-DD
 */
const formatDate = (date) => {
  var d = new Date(date),
    month = "" + (d.getMonth() + 1),
    day = "" + d.getDate(),
    year = d.getFullYear();

  if (month.length < 2) month = "0" + month;
  if (day.length < 2) day = "0" + day;

  return [year, month, day].join("-");
};

const getHeaders = (sheetName) => {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  let data = sheet.getDataRange().getValues();
  let headers = data[0];
  return headers;
};

/**
 * Removes transactions from the spreadsheet
 */
const reset = () => {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(runningTransactionsSheetName);

  var last_row = sheet.getLastRow();
  sheet.getRange("2:" + last_row).activate();
  sheet
    .getActiveRangeList()
    .clear({ contentsOnly: true, skipFilteredRows: true });
};

/**
 * Accounts is an object generated from the /get transactions endpoint. But transactions don't contain account info so this needs to be supplemented.
 * @param {} accounts
 * @returns
 */
const getAccountsMap = (accounts) => {
  let result = {};
  accounts.forEach((account) => {
    result[account.account_id] = account;
  });
  return result;
};

/**
 * Returns array of transaction IDs
 */
const getTransactionIds = (columnLetter) => {
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(runningTransactionsSheetName);
  let transactionIds = sheet
    .getRange(`${columnLetter}2:${columnLetter}`)
    .getValues()
    .flat();
  // filter out blank values
  transactionIds = transactionIds.filter((id) => id !== "");
  return transactionIds;
};

const alertViaEmail = (owner, account, func, error) => {
  if (email) {
    MailApp.sendEmail(
      email,
      `Plaid To Google Sheets - ${owner} - ${account} - ${func}`,
      `Error: ${JSON.stringify(error)}`
    );
  }
};

/**
 * Gets the start date by looking at row 2 of a specified column. Assumes the dataset is sorted.
 * @returns the start date to send to plaid API
 */
const getStartDate = () => {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(runningTransactionsSheetName);
  const val = sheet.getRange(2, transactionsDateColumnNumber + 1).getValue();
  let start_date;
  // If there is no data in the column, the start date is the current date minus 800 days which should get the last 2 years of data (plaid's max)
  if (val == "") {
    start_date = new Date();
    start_date.setDate(start_date.getDate() - 800);
  } else {
    // If there a latest date, use the latest minus the 10 days to account for any transactions that may have been processed
    start_date = new Date(val);
    start_date.setDate(start_date.getDate() - 10);
  }
  return start_date;
};

const getJsonArrayFromData = (data) => {
  var obj = {};
  var result = [];
  var headers = data[0];
  var cols = headers.length;
  var row = [];

  for (var i = 1, l = data.length; i < l; i++) {
    // get a row to fill the object
    row = data[i];
    // clear object
    obj = {};
    for (var col = 0; col < cols; col++) {
      // fill object with new values
      obj[headers[col]] = row[col];
    }
    // add object in a final result
    result.push(obj);
  }

  return result;
};
