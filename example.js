const noise = require('./')

const server = noise.createServer()

server.on('connection', function (connection) {
  console.log('someone joined wup wup')
  connection.on('data', console.log)
})

server.listen(noise.keygen(), function () {
  const client = noise.connect(server.publicKey)
  client.write('hello world')
})
