# noise-network

Authenticated network P2P backed by [HyperSwarm](https://github.com/hyperswarm) and [NOISE](https://github.com/emilbayes/noise-peer)

## Usage

First spin up a server

```js
const noise = require('noise-network')

const server = noise.createServer()

server.on('connection', function (encryptedStream) {
  console.log('new encrypted stream!')

  // encryptedStream is a noise-peer stream instance
  encryptedStream.on('data', function (data) {
    console.log('client wrote:', data)
  })
})

const keyPair = noise.keygen()

// Announce ourself to the HyperSwarm DHT on the following keyPair's publicKey
server.listen(keyPair, function () {
  console.log('Server is listening on:', server.publicKey.toString('hex'))
})
```

Then connect to the server by connecting to the public key

```js
// noise guarantees that we connect to the server in a E2E encrypted stream
const client = noise.connect('{public key from above}')

// client is a noise-peer stream instance
client.write('hello server')
```

## API

#### `const server = noise.createServer([options])`

Create a new NOISE server.

Options include:

```js
{
  // validate the remote client's public key before allowing them to connect
  validate (remoteKey, done) { ... },
  // you can add the onconnection handler here also
  onconnection (connection) { ... }
}
```

#### `const client = noise.connect(serverPublicKey, [keyPair])`

Connect to a server. Does UDP hole punching if nessesary.

## License

MIT
