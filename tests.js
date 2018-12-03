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
