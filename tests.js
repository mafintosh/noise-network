var network = require('.')
var test = require('tape')

test('destroy', function (assert) {
  assert.plan(2)
  var server = network.createServer(function (s) {
    assert.pass('Connected')
    s.pipe(s)
    s.on('error', assert.error)
  })

  var serverKeys = network.keygen()
  server.listen(serverKeys, function () {
    var client = network.connect(serverKeys.publicKey)

    client.on('handshake', () => {
      server.close()
    })

    client.end(assert.pass)
  })
})

test('accepts keys as hex', { timeout: 1000 }, function (assert) {
  assert.plan(3)
  var server = network.createServer()
  var client

  server.on('connection', function (encryptedStream) {
    assert.pass('Connected')
    encryptedStream.pipe(encryptedStream)
    encryptedStream.on('error', assert.error)

    encryptedStream.on('data', function (data) {
      assert.pass('received data')

      server.close()
      client.end(assert.pass)
    })
  })

  var serverKeys = network.keygen()
  var keys = {
    publicKey: serverKeys.publicKey.toString('hex'),
    secretKey: serverKeys.secretKey.toString('hex')
  }

  server.listen(keys, function connectClient () {
    client = network.connect(keys.publicKey)
    client.write('hello')
  })
})
