function doGet(e) {
  var result = {};
  var params = e.parameter;
  var action = params.action;
  var key = params.key;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  if (action === 'verify') {
    result = verifyKey(sheet, data, key);
  } else if (action === 'activate') {
    result = activateKey(sheet, data, key);
  } else if (action === 'list_keys') {
    result = listKeys(data);
  } else {
    result = { error: 'Invalid action' };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var result = {};
  var params = JSON.parse(e.postData.contents);
  var action = params.action;
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  if (action === 'add_key') {
    result = addKey(sheet, data, params.key, params.duration, params.notes || '');
  } else if (action === 'delete_key') {
    result = deleteKey(sheet, data, params.key);
  } else {
    result = { error: 'Invalid action' };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function getTimestamp(val) {
  if (typeof val === 'object' && val instanceof Date) return val.getTime();
  if (typeof val === 'number') return val;
  return null;
}

function verifyKey(sheet, data, key) {
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      var durationDays = Number(data[i][1]);
      var activatedAt = data[i][2];
      var now = Date.now();
      var activatedAtMs = getTimestamp(activatedAt);

      if (activatedAt === '' || activatedAt === undefined || activatedAt === null || activatedAtMs === null) {
        return { status: 'ready_to_activate', durationDays: durationDays };
      }

      var expiresAt = activatedAtMs + (durationDays * 86400000);

      if (now < expiresAt) {
        var daysRemaining = Math.ceil((expiresAt - now) / 86400000);
        return { status: 'active', daysRemaining: daysRemaining, expiresAt: expiresAt };
      } else {
        return { status: 'expired', expiresAt: expiresAt };
      }
    }
  }
  return { status: 'invalid' };
}

function activateKey(sheet, data, key) {
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      var durationDays = Number(data[i][1]);
      var activatedAt = data[i][2];
      var activatedAtMs = getTimestamp(activatedAt);

      if (activatedAt !== '' && activatedAt !== undefined && activatedAt !== null && activatedAtMs !== null) {
        var expiresAt = activatedAtMs + (durationDays * 86400000);
        return { status: 'already_activated', expiresAt: expiresAt };
      }

      var now = new Date();
      var nowMs = now.getTime();
      var cell = sheet.getRange(i + 1, 3);
      cell.setValue(now);
      cell.setNumberFormat('M/d/yyyy h:mm:ss AM/PM');
      var expiresAt = nowMs + (durationDays * 86400000);
      return { status: 'activated', expiresAt: expiresAt };
    }
  }
  return { status: 'invalid' };
}

function addKey(sheet, data, key, duration, notes) {
  if (!key || !duration) {
    return { success: false, error: 'Key and duration required' };
  }
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      return { success: false, error: 'Key already exists' };
    }
  }
  var now = new Date();
  sheet.appendRow([key, Number(duration), '', notes, now]);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 5).setNumberFormat('M/d/yyyy h:mm:ss AM/PM');
  return { success: true };
}

function deleteKey(sheet, data, key) {
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Key not found' };
}

function listKeys(data) {
  var keys = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var durationDays = Number(row[1]);
    var activatedAt = row[2];
    var now = Date.now();
    var status = 'not_activated';
    var daysRemaining = null;
    var expiresAt = null;
    var activatedAtMs = getTimestamp(activatedAt);

    if (activatedAt !== '' && activatedAt !== undefined && activatedAt !== null && activatedAtMs !== null) {
      expiresAt = activatedAtMs + (durationDays * 86400000);
      if (now < expiresAt) {
        status = 'active';
        daysRemaining = Math.ceil((expiresAt - now) / 86400000);
      } else {
        status = 'expired';
      }
    }

    keys.push({
      key: row[0],
      durationDays: durationDays,
      status: status,
      daysRemaining: daysRemaining,
      expiresAt: expiresAt,
      notes: row[3] || '',
      createdAt: row[4] || null
    });
  }
  return { keys: keys };
}

/* Run this once from the Apps Script editor to convert
   existing raw millisecond numbers to readable dates.
   Select "migrateDates" in the function dropdown and click Run. */
function migrateDates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var fixed = 0;

  for (var i = 1; i < data.length; i++) {
    // Migrate Activated At (Column C)
    var actVal = data[i][2];
    if (typeof actVal === 'number' && actVal > 1000000000000) {
      sheet.getRange(i + 1, 3).setValue(new Date(actVal));
      sheet.getRange(i + 1, 3).setNumberFormat('M/d/yyyy h:mm:ss AM/PM');
      fixed++;
    }
    // Migrate Created At (Column E)
    var creVal = data[i][4];
    if (typeof creVal === 'number' && creVal > 1000000000000) {
      sheet.getRange(i + 1, 5).setValue(new Date(creVal));
      sheet.getRange(i + 1, 5).setNumberFormat('M/d/yyyy h:mm:ss AM/PM');
      fixed++;
    }
  }

  SpreadsheetApp.getUi().alert('Migration complete. ' + fixed + ' cell(s) converted to readable dates.');
}
