const utp = require('utp-native')
const net = require('net')
const sodium = require('sodium-native')
const noise = require('noise-peer')
const Nanoresource = require('nanoresource')
const Duplexify = require('duplexify')
const discovery = require('@hyperswarm/discovery')
const { EventEmitter } = require('events')

exports.globalAgent = null
exports.agent = () => new NoiseAgent()
exports.keygen = noise.keygen
exports.seedKeygen = noise.seedKeygen
exports.createServer = (opts) => new NoiseServer(opts)
exports.connect = connect

function connect (publicKey) {
  if (typeof publicKey === 'string') publicKey = Buffer.from(publicKey, 'hex')

  if (exports.globalAgent && !exports.globalAgent.closed) {
    return exports.globalAgent.connect(publicKey)
  }

  exports.globalAgent = new NoiseAgent()
  const stream = exports.globalAgent.connect(publicKey)
  exports.globalAgent.close()
  return stream
}

class NoiseServer extends EventEmitter {
  constructor (opts) {
    if (!opts) opts = {}
    if (typeof opts === 'function') opts = { onconnection: opts }

    super()

    this.connections = new Set()
    this.server = new ServerResource(this._onrawstream.bind(this))
    this.keyPair = null
    this.discoveryKey = null
    this.topic = null
    this.validate = opts.validate || null

    if (opts.onconnection) this.on('connection', opts.onconnection)
  }

  _onrawstream (rawStream) {
    const self = this

    const encryptedStream = noise(rawStream, false, {
      pattern: 'XK',
      staticKeyPair: this.keyPair,
      onstatickey: function (remoteKey, done) {
        if (self.validate) return self.validate(remoteKey, done)
        done(null)
      }
    })

    encryptedStream.on('handshake', function () {
      if (self.server.closed) return encryptedStream.destroy()
      encryptedStream.on('close', self.connections.delete.bind(self.connections, encryptedStream))
      self.connections.add(encryptedStream)
      self.emit('connection', encryptedStream)
    })

    encryptedStream.on('error', function (err) {
      self.emit('clientError', err)
    })
  }

  get publicKey () {
    return this.keyPair && this.keyPair.publicKey
  }

  address () {
    return this.server.tcp && this.server.tcp.address()
  }

  listen (keyPair, cb) {
    if (!cb) cb = noop

    const self = this

    this.server.open(function (err) {
      if (err) return cb(err)
      if (self.keyPair) return cb(new Error('Already listening'))

      const localPort = self.server.tcp.address().port

      self.discoveryKey = discoveryKey(keyPair.publicKey)
      self.keyPair = keyPair
      self.topic = self.server.discovery.announce(self.discoveryKey, { localPort, port: 0 })
      self.topic.on('update', () => self.emit('announce'))
      self.emit('listening')

      cb(null)
    })
  }

  close (cb) {
    if (!cb) cb = noop

    const self = this

    this.server.close(function (err) {
      if (err) return cb(err)
      self.topic = null
      self.discoveryKey = null
      self.keyPair = null
      self.emit('close')
      cb(null)
    })
  }
}

class RawStream extends Duplexify {
  constructor (agent, publicKey, timeout) {
    super()

    this.agent = agent
    this.publicKey = publicKey

    const topic = agent.discovery.lookup(discoveryKey(publicKey))

    this.topic = topic
    this.tried = new Set()
    this.connected = false

    topic.on('peer', this._onpeer.bind(this))

    this._timeout = timeout
      ? setTimeout(this.destroy.bind(this, new Error('ETIMEDOUT')), timeout)
      : null

    this.on('close', this._onclose)
  }

  _onclose () {
    if (this._timeout) clearTimeout(this._timeout)
    this._timeout = null
    this.agent.inactive()
  }

  _onpeer (peer) {
    if (this.destroyed || this.connected) return

    const id = peer.host + ':' + peer.port

    if (this.tried.has(id)) return
    this.tried.add(id)

    this._connect(peer)
  }

  _connect (peer) {
    const self = this
    const tcp = net.connect({
      port: peer.port,
      host: peer.host,
      allowHalfOpen: true
    })

    tcp.on('error', tcp.destroy)
    tcp.on('connect', onconnect)

    if (!peer.referrer) return

    this.agent.discovery.holepunch(peer, function (err) {
      if (err || self.connected || self.destroyed) return

      const utp = self.agent.utp.connect(peer.port, peer.host, { allowHalfOpen: true })

      utp.on('error', utp.destroy)
      utp.on('connect', onconnect)
    })

    function onconnect () {
      if (self.destroyed || self.connected) return this.destroy()
      clearTimeout(self._timeout)
      self._timeout = null

      self.connected = true
      self.setReadable(this)
      self.setWritable(this)
      self.emit('connect')

      const destroy = self.destroy.bind(self)

      this.on('error', destroy)
      this.on('close', destroy)
    }
  }
}

class NoiseAgent extends Nanoresource {
  constructor () {
    super()

    this.utp = null
    this.discovery = null
  }

  connect (publicKey, keyPair) {
    this.open()
    this.active()

    const rawStream = new RawStream(this, publicKey)

    return noise(rawStream, true, {
      pattern: 'XK',
      staticKeyPair: keyPair || noise.keygen(),
      remoteStaticKey: publicKey
    })
  }

  _open (cb) {
    this.utp = utp()
    this.discovery = discovery({ socket: this.utp })
    cb(null)
  }

  _close (cb) {
    this.discovery.destroy()
    this.discovery.once('close', cb)
  }
}

class ServerResource extends Nanoresource {
  constructor (onconnection) {
    super()

    this.onconnection = onconnection
    this.discovery = null
    this.utp = null
    this.tcp = null
  }

  _open (cb) {
    const self = this

    this.utp = utp({ allowHalfOpen: true })
    this.tcp = net.createServer({ allowHalfOpen: true })

    listenBoth(this.tcp, this.utp, function (err) {
      if (err) return cb(err)

      self.discovery = discovery({ socket: self.utp })
      self.utp.on('connection', self.onconnection)
      self.tcp.on('connection', self.onconnection)

      cb(null)
    })
  }

  _close (cb) {
    const self = this

    this.discovery.destroy()
    this.discovery.once('close', function () {
      self.tcp.close()
      self.tcp = null
      self.utp = null
      self.discovery = null
      cb(null)
    })
  }
}

function listenBoth (tcp, utp, cb) {
  tcp.on('listening', onlistening)
  utp.on('listening', done)
  utp.on('error', retry)

  tcp.listen(0)

  function retry (err) {
    if (err.code !== 'EADDRINUSE') {
      tcp.once('close', () => cb(err))
      tcp.close()
      return
    }

    tcp.once('close', () => tcp.listen(0))
    tcp.close()
  }

  function done () {
    utp.removeListener('done', done)
    tcp.removeListener('listening', onlistening)
    utp.removeListener('error', retry)
    cb()
  }

  function onlistening () {
    utp.listen(tcp.address().port)
  }
}

function noop () {}

function discoveryKey (publicKey) {
  const buf = Buffer.alloc(32)
  const str = Buffer.from('noise-network')
  sodium.crypto_generichash(buf, str, publicKey)
  return buf
}
