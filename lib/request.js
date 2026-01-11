'use strict';

const debug = require('debug')('fritzbox:request');
const got = require('got');
const cheerio = require('cheerio');
const crypto = require('crypto');
const querystring = require('querystring');
const { parseStringPromise } = require('xml2js');

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

const parseWwwAuthenticateDigest = (headerValue) => {
  if (!headerValue || typeof headerValue !== 'string') {
    return null;
  }

  const trimmed = headerValue.trim();
  if (!/^digest\s+/i.test(trimmed)) {
    return null;
  }

  const params = {};
  const challenge = trimmed.replace(/^digest\s+/i, '');
  const re = /(\w+)=("([^"]*)"|([^,\s]+))/g;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = re.exec(challenge))) {
    const key = match[1];
    const value = match[3] ?? match[4] ?? '';
    params[key] = value;
  }

  if (!params.nonce) {
    return null;
  }

  return params;
};

const buildDigestAuthorizationHeader = (challenge, username, password, method, uri) => {
  const realm = challenge.realm ?? '';
  const nonce = challenge.nonce;
  const opaque = challenge.opaque;

  const algorithm = (challenge.algorithm ?? 'MD5').toUpperCase();
  const qopRaw = challenge.qop;
  const qop = qopRaw && qopRaw.split(',').map((x) => x.trim()).includes('auth') ? 'auth' : null;

  const cnonce = crypto.randomBytes(16).toString('hex');
  const nc = '00000001';

  let ha1 = md5(`${username}:${realm}:${password}`);
  if (algorithm === 'MD5-SESS') {
    ha1 = md5(`${ha1}:${nonce}:${cnonce}`);
  }

  const ha2 = md5(`${method}:${uri}`);

  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];

  if (algorithm) {
    parts.push(`algorithm=${algorithm}`);
  }

  if (opaque) {
    parts.push(`opaque="${opaque}"`);
  }

  if (qop) {
    parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  }

  return `Digest ${parts.join(', ')}`;
};

exports.parseOutput = (data, target, value) => {
  let $ = cheerio.load(data);
  const inputs = $('input').toArray();

  if (target && value) {
    const elements = inputs.filter((input) => input.attribs.name === target);
    const element = elements.find((el) => el.attribs.value === value);
    return element ? element.attribs : {};
  }

  if (target) {
    return inputs.filter((input) => input.attribs.name === target);
  }

  return data;
};

exports.createDigestClient = (username, password) => {
  return got.extend({
    hooks: {
      afterResponse: [
        (res, retry) => {
          const options = res.request.options;
          const digestHeader = res.headers['www-authenticate'];

          if (!digestHeader || options.headers.authorization) {
            return res;
          }

          const incomingDigest = parseWwwAuthenticateDigest(digestHeader);
          if (!incomingDigest) {
            return res;
          }

          debug('Incoming digest', incomingDigest);

          const method = options.method ?? 'GET';
          const uri = `${options.url.pathname}${options.url.search ?? ''}`;
          options.headers.authorization = buildDigestAuthorizationHeader(incomingDigest, username, password, method, uri);

          return retry(options);
        },
      ],
      beforeRetry: [
        (options, error, retryCount) => {
          debug('Retry Digest', options.headers, error, retryCount);
        },
      ],
    },
  });
};

exports.request = async (uri, options) => {
  try {
    if (!options.sendImmediately && options.username && options.password) {
      const instance = this.createDigestClient(options.username, options.password);

      //IMPORTANT: Encode username/password AFTER creating digest client
      options.username = encodeURI(options.username);
      options.password = encodeURI(options.password);

      return await instance(uri, options);
    }

    return await got(uri, options);
  } catch (err) {
    if (err.response) {
      const error = new Error(`${err.response.statusCode} - ${err.response.statusCode}`);
      let soapError = {};

      try {
        const result = await parseStringPromise(err.response.body);

        soapError = {
          errorCode: result['s:Envelope']['s:Body'][0]['s:Fault'][0].detail[0].UPnPError[0].errorCode[0],
          errorDescription: result['s:Envelope']['s:Body'][0]['s:Fault'][0].detail[0].UPnPError[0].errorDescription[0],
          action: options.headers && options.headers.SoapAction ? options.headers.SoapAction : 'unknown',
        };
      } catch {
        //unhandled
      }

      Object.assign(error, {
        title: 'Invalid Response',
        code: err.response.statusCode,
        message: err.response.statusMessage,
        soap: soapError,
        url: err.response.url || uri,
      });

      throw error;
    } else if (err.request) {
      const error = new Error(`${err.message} - ${err.code}`);

      Object.assign(error, {
        title: 'No Response',
        code: err.code,
        message: err.message,
        soap: {
          action: options.headers && options.headers.SoapAction ? options.headers.SoapAction : 'unknown',
        },
        url: err.request.requestUrl || uri,
      });

      throw error;
    } else {
      throw new Error(err);
    }
  }
};

exports.requestAHA = async (host, cmd) => {
  const uri = `http://${host}/webservices/homeautoswitch.lua`;

  debug('Request AHA', {
    uri: uri,
    ...cmd,
  });

  try {
    const response = await got(uri, {
      method: 'GET',
      searchParams: cmd,
    });

    return response.body;
  } catch (err) {
    if (err.response) {
      const error = new Error(`${err.response.statusCode} - ${err.response.statusCode}`);

      Object.assign(error, {
        title: 'Invalid Response',
        code: err.response.statusCode,
        message: err.response.statusMessage,
        url: err.response.url || uri,
      });

      throw error;
    } else if (err.request) {
      const error = new Error(`${err.message} - ${err.code}`);

      Object.assign(error, {
        title: 'No Response',
        code: err.code,
        message: err.message,
        url: err.request.requestUrl || uri,
      });

      throw error;
    } else {
      throw new Error(err);
    }
  }
};

exports.requestLUA = async (params, host, path, target, exec, value) => {
  const uri = `http://${host}${path}`;

  debug('Request LUA', {
    uri: uri,
    params: params,
    target: target,
    exec: exec,
  });

  try {
    const response = await got.post(uri, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: querystring.stringify(params),
    });

    if (target && !exec) {
      return this.parseOutput(response.body, target, value);
    }

    let body = response.body;

    try {
      body = JSON.parse(response.body);
    } catch {
      //unhandled
    }

    return body;
  } catch (err) {
    if (err.response) {
      const error = new Error(`${err.response.statusCode} - ${err.response.statusCode}`);

      Object.assign(error, {
        title: 'Invalid Response',
        code: err.response.statusCode,
        message: err.response.statusMessage,
        url: err.response.url || uri,
      });

      throw error;
    } else if (err.request) {
      const error = new Error(`${err.message} - ${err.code}`);

      Object.assign(error, {
        title: 'No Response',
        code: err.code,
        message: err.message,
        url: err.request.requestUrl || uri,
      });

      throw error;
    } else {
      throw new Error(err);
    }
  }
};

exports.requestXml = async (uri, options) => {
  debug('Request XML', {
    uri: uri,
    ...options,
  });

  const response = await this.request(uri, options);

  return await parseStringPromise(response.body, {
    explicitArray: false,
  });
};
