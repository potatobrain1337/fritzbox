# @seydx/fritzbox (community fork)

> A promise based library for accessing a Fritz!Box via TR-064 API.
>
> This repository is a community-maintained fork used by `homebridge-fritz-platform-community`.
> Upstream is `SeydX/fritzbox` (forked from [@ulfalfa](https://gitlab.com/ulfalfa/fritzbox)).

## Features

This library is capable of:

- Supports the complete command language of the TR-064 API of an Fritz!Box
- No callback, only promises
- SSL encryption and authentication

## Install

```
npm install github:potatobrain1337/fritzbox#v2.3.2-community.0
```

## Usage

### Getting the info about the fritzbox

With the method `exec` you can access all services and actions in the fritz box even with parameters

```js
const Fritzbox = require('@seydx/fritzbox');
const fritzbox = new Fritzbox({ username: 'test', password: 'testPwd123' });

// Async/Await:
async function getDeviceInfo () {
  try {
    const info = await fritzbox.exec(
      'urn:DeviceInfo-com:serviceId:DeviceInfo1',
      'GetInfo'
    );
    console.log(info);
  } catch (err) {
    console.error(err);
  }
}
```

### Getting all currently known hosts by Fritz!Box

```js
const Fritzbox = require('@seydx/fritzbox');
const fritzbox = new Fritzbox({ username: 'test', password: 'testPwd123' });

// Async/Await:
async function getHosts () {
  try {
    const allHosts = await fritzbox.getAllHosts();
    console.log(allHosts);
  } catch (err) {
    console.error(err);
  }
}
```

### Retrieving all services with their corresponding actions

```js
const Fritzbox = require('@seydx/fritzbox');
const fritzbox = new Fritzbox({ username: 'test', password: 'testPwd123' });

// Async/Await:
async function getServices () {
  try {
    const services = await fritzbox.describe();
    console.log(services);
  } catch (err) {
    console.error(err);
  }
}
```
