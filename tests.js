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

test('connect', { timeout: 1000 }, function (assert) {
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
  server.listen(serverKeys, connectClient)

  function connectClient () {
    client = network.connect(serverKeys.publicKey)
    client.write('hello')
  }
})
