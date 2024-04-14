// 環境変数からAPIキーとトークン、フォルダIDを取得
const GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
const LINE_CHANNEL_ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
const OUT_DIR_ID = PropertiesService.getScriptProperties().getProperty('OUT_DIR_ID');

const REPLY_URL = 'https://api.line.me/v2/bot/message/reply';
const sCache = CacheService.getScriptCache();

/**
 * LINEのトークでメッセージが送信された際に起動するメソッド
 */
function doPost(e) {
  const eventData = JSON.parse(e.postData.contents).events[0],
        repToken = eventData.replyToken,
        msgType = eventData.message.type;
  
  if (msgType == 'text') {
    let uText = eventData.message.text, gemini;
    if (!sCache.get('image')) {
      gemini = getGeminiProAnswerTxt(uText);
    } else {
      gemini = getGeminiProVisionAnswerTxt(uText, sCache.get('image'));
      DriveApp.getFileById(sCache.get('image')).setTrashed(true);
      sCache.remove('image');
    }
    replyTxt(repToken, gemini);
    sCache.put('user', uText.slice(0, 10000));
    sCache.put('model', gemini.slice(0, 10000));
  } else if (msgType == 'image') {
    let imageId = getImageId4Create(eventData);
    sCache.put('image', imageId);
    replyTxt(repToken, '送信された画像について聞きたいことは何ですか？');
  }
}

/**
 * LINEのトークに送信されたメッセージをGemini Pro APIに渡して回答を得るメソッド
 */
function getGeminiProAnswerTxt(txt) {
  let contentsStr = '';
  if (sCache.get('user')) {
    contentsStr += `{
      "role": "user",
      "parts": [{
        "text": ${JSON.stringify(sCache.get('user'))}
      }]
    },{
      "role": "model",
      "parts": [{
        "text": ${JSON.stringify(sCache.get('model'))}
      }]
    },`;
  }
  contentsStr += `{
    "role": "user",
    "parts": [{
      "text": ${JSON.stringify(txt)}
    }]
  }`;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`,
        payload = {
            'contents': JSON.parse(`[${contentsStr}]`)
          },
        options = {
            'method': 'post',
            'contentType': 'application/json',
            'payload': JSON.stringify(payload)
          };
  const res = UrlFetchApp.fetch(url, options),
        resJson = JSON.parse(res.getContentText());

  if (resJson && resJson.candidates && resJson.candidates.length > 0) {
    return resJson.candidates[0].content.parts[0].text;
  } else {
    return '回答を取得できませんでした。';
  }
}

/**
 * LINEのトークで送信された画像をGoogleドライブに保存し、ファイルIDを返却するメソッド
 */
function getImageId4Create(e) {
  const url = `https://api-data.line.me/v2/bot/message/${e.message.id}/content`,
        options = { 
            'method': 'get',
            'headers': {
              'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
            }
          };
  const data = UrlFetchApp.fetch(url, options),
        imageData = data.getBlob().getAs('image/png').setName(Number(new Date()));
  return DriveApp.getFolderById(OUT_DIR_ID).createFile(imageData).getId();
}

/**
 * LINEのトークに送信されたメッセージをGemini Pro Vision APIに渡して回答を得るメソッド
 */
function getGeminiProVisionAnswerTxt(txt, imageid) {
  try {
    let file = DriveApp.getFileById(imageid);
    let blob = file.getBlob();
    let base64Data = Utilities.base64Encode(blob.getBytes());
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-vision:generateContent?key=${GEMINI_API_KEY}`,
          payload = {
              'contents': [{
                'parts': [{
                  'text': txt
                },{
                  'inlineData': {
                    'mimeType': 'image/png', // MIMEタイプを正しく指定
                    'data': base64Data
                  }
                }]
              }]
            },
          options = {
              'method': 'post',
              'contentType': 'application/json',
              'payload': JSON.stringify(payload)
            };

    const res = UrlFetchApp.fetch(url, options),
          resJson = JSON.parse(res.getContentText());

    if (resJson && resJson.candidates && resJson.candidates.length > 0) {
      return resJson.candidates[0].content.parts[0].text;
    } else {
      return '申し訳ございません。お答えできません。';
    }
  } catch (ex) {
    return '申し訳ございません。Gemini Proの呼び出しで異常終了しました。';
  }
}


/**
 * LINEのトークにメッセージを返却するメソッド
 */
function replyTxt(token, txt) {
  const message = {
    'replyToken': token,
    'messages': [{
      'type': 'text',
      'text': txt
    }]
  },
  options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    'payload': JSON.stringify(message)
  };
  UrlFetchApp.fetch(REPLY_URL, options);
}

