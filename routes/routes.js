const request = require('request');
const fs = require('fs');

// App to retrieve short lived token
const client_id = '';
const client_secret = '';

// ArcGIS Url
const oauth2Url = 'https://www.arcgis.com/sharing/rest/oauth2/token/';
const featureServerUrl = '';
const featureServerUploadUrl = `${featureServerUrl}/uploads/upload`;
const featureServerAppendUrl = `${featureServerUrl}/0/append`;
const featureServerDeleteUrl = `${featureServerUrl}/0/deleteFeatures`;
const dataProps = [
  'nThumbsUp',
  'city',
  'reportRating',
  'confidence',
  'reliability',
  'type',
  'uuid',
  'magvar',
  'subtype',
  'street',
  'reportDescription',
  'pubMillis',
  'pubMillis_dt',
  'longitude',
  'latitude'
];
const convertToSeconds = x => Math.floor(x / 1000);
const convertToDateTime = x => {
  // i.e 11/10/2018, 3:58:39 PM -> 11/10/2018 3:58:39 PM
  return new Date(x).toLocaleString().replace(',', '');
};
const durationPreserved = 259200; // 72 hours worth of data

const getData = type =>
  new Promise((resolve, reject) => {
    const url = ``;

    request(
      {
        url: url,
        headers: {},
        method: 'GET',
        encoding: null
      },
      function(error, res, body) {
        if (res.statusCode == 200 && !error) {
          resolve(JSON.parse(body));
        }
        reject(error);
      }
    );
  });

const createCSV = (data, type) =>
  new Promise((resolve, reject) => {
    const csvHeader = dataProps.join(',') + '\n';
    const filePath = `/tmp/feed-${type}.csv`;

    // value order according to dataProps
    const rowsToInsert = data.alerts
      .map((value, index) =>
        [
          value.nThumbsUp || 0,
          value.city || '',
          value.reportRating || 0,
          value.confidence || 0,
          value.reliability || 0,
          value.type || '',
          value.uuid || '',
          value.magvar || 0,
          value.subtype || '',
          `\"${value.street || ''}\"`,
          `\"${value.reportDescription || ''}\"`,
          convertToSeconds(value.pubMillis) || 0,
          convertToDateTime(value.pubMillis) || 0,
          value.location.x || 0,
          value.location.y || 0
        ].join(',')
      )
      .join('\n');

    const fileContent = csvHeader + rowsToInsert;

    fs.writeFile(filePath, fileContent, function(error, fileContent) {
      if (!error) {
        resolve(filePath);
      }
      reject(error);
    });
  });

const requestToken = () =>
  // generate a token with client id and client secret
  new Promise((resolve, reject) => {
    request.post(
      {
        url: oauth2Url,
        json: true,
        form: {
          f: 'json',
          client_id,
          client_secret,
          grant_type: 'client_credentials',
          expiration: '1440'
        }
      },
      function(error, response, { access_token }) {
        if (error) reject(error);

        resolve(access_token);
      }
    );
  });

const uploadCSV = (file, token) =>
  new Promise((resolve, reject) => {
    request.post(
      {
        url: featureServerUploadUrl,
        json: true,
        formData: {
          csv_file: fs.createReadStream(file),
          f: 'json',
          token
        }
      },
      function(error, response, body) {
        if (error) reject(error);

        if (body.success) {
          resolve(body.item.itemID);
        } else {
          reject(body.error && body.error.message);
        }
      }
    );
  });

const upsert = (appendUploadId, token) =>
  new Promise((resolve, reject) => {
    const fieldMappings = dataProps.map(x => ({ source: x, name: x }));

    const appendSourceInfo = {
      type: 'csv',
      useBulkInserts: true,
      sourceUrl: '',
      locationType: 'coordinates',
      longitudeFieldName: 'longitude',
      latitudeFieldName: 'latitude',
      columnDelimiter: ',',
      qualifier: '"',
      sourceSR: {
        wkid: 4326,
        latestWkid: 4326
      }
    };

    const formData = {
      f: 'json',
      fieldMappings: JSON.stringify(fieldMappings),
      appendSourceInfo: JSON.stringify(appendSourceInfo),
      upsert: 'true',
      skipInserts: 'false',
      skipUpdates: 'false',
      useGlobalIds: 'false',
      updateGeometry: 'true',
      upsertMatchingField: 'uuid',
      appendUploadId,
      appendUploadFormat: 'csv',
      rollbackOnFailure: 'false',
      token
    };

    request.post(
      {
        url: featureServerAppendUrl,
        json: true,
        formData
      },
      function(error, response, body) {
        if (error) reject(error);
        if (body.statusUrl) {
          resolve(body.statusUrl);
        } else {
          reject(error);
        }
      }
    );
  });

const deleteData = token =>
  new Promise((resolve, reject) => {
    const now = new Date();
    const timeForDelete = convertToSeconds(now.getTime()) - durationPreserved;

    const where = 'pubMillis <= ' + timeForDelete;

    const formData = {
      f: 'json',
      where,
      token
    };

    request.post(
      {
        url: featureServerDeleteUrl,
        json: true,
        formData
      },
      function(error, response, body) {
        if (error) reject(error);

        if (body.deleteResults && body.deleteResults.length) {
          resolve(body.deleteResults.length);
        } else {
          reject(body);
        }
      }
    );
  });

const appRouter = app => {
  app.get('/append/:type', async (req, res) => {
    const typeList = ['alerts'];

    if (typeList.includes(req.params.type)) {
      try {
        // 1. Get waze data from world-georss
        const data = await getData(req.params.type);

        // 2. Create a CSV for that feed
        const file = await createCSV(data, req.params.type);

        // 3. Request tokens from ArcGIS online
        const token = await requestToken();

        // 4. Upload CSV
        const appendUploadId = await uploadCSV(file, token);

        // 5. Finally run upsert with CSV
        const statusUrl = await upsert(appendUploadId, token);

        res
          .status(200)
          .send(
            `[${appendUploadId}] Append complete: <a href="${statusUrl}?token=${token}" target="_blank">result</a>`
          );
        return;
      } catch (e) {
        console.log(e);
      }

      res.status(200).send('Append complete');
    } else {
      res.status(200).send('Not querying: Waze data');
    }
  });

  app.get('/delete', async (req, res) => {
    // Request tokens from ArcGIS online
    const token = await requestToken();

    try {
      const deleteResults = await deleteData(token);
      res.status(200).send(`Delete complete: ${deleteResults} rows deleted.`);
      return;
    } catch (e) {
      console.log(e);
    }

    res.status(200).send('Delete complete');
  });

  app.get('/', (req, res) => {
    res.status(200).send('Waze data');
  });
};

module.exports = appRouter;
