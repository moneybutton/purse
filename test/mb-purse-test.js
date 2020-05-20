/* global def, get */
import should from 'should'
import bsv from 'bsv'
import { MBPurse } from '../src/mb-purse'

const address1 = bsv.PrivateKey.fromRandom().toAddress()
const address2 = bsv.PrivateKey.fromRandom().toAddress()

class MockPaymailClient {
  constructor (userPaymail, responseAddress) {
    this.validPaymail = userPaymail
    this.responseAddress = responseAddress
    this.responses = []
  }

  async getOutputFor (aPaymail, senderData) {
    if (aPaymail !== this.validPaymail) {
      throw new Error('Invalida paymail: ' + aPaymail)
    }
    if (!senderData.senderHandle) {
      throw new Error('missing senderHandle')
    }
    if (!senderData.signature) {
      throw new Error('missing signature')
    }
    if (!senderData.dt) {
      throw new Error('missing dt')
    }
    const response = bsv.Script.fromAddress(this.responseAddress).toHex()
    this.responses = [...this.responses, response]
    return response
  }
}

class MockImb {
  constructor (bsv, userPaymail) {
    this.swipes = []
    this.bsv = bsv
    this.userPaymail = userPaymail
  }

  _buildPayment (config) {
    const responseTx = new bsv.Transaction()
    responseTx.to(config.to, Number(config.amount))
    return {
      txid: responseTx.hash,
      rawtx: responseTx.uncheckedSerialize()
    }
  }

  async swipe (config) {
    const response = {
      payment: config.to
        ? this._buildPayment(config)
        : null,
      cryptoOperations: config.cryptoOperations
        ? config.cryptoOperations.map(co => ({ ...co, value: this.userPaymail }))
        : []
    }
    this.swipes = [ ...this.swipes, { config, response } ]
    return response
  }
}

describe('MBPurse', () => {
  def('userPaymail', () => 'example@moneybutton.com')
  def('changeAddress', () => bsv.PrivateKey.fromRandom().toAddress())
  def('imb', () => new MockImb(bsv, get.userPaymail))
  def('pmClient', () => new MockPaymailClient(get.userPaymail, get.changeAddress))
  def('txToFundInputs', () => [])
  def('txToFundInputParents', () => get.txToFundInputs.map(input => ({ satoshis: input.satoshis, script: input.script.toASM() })))
  def('txToFundOutputs', () => [])
  def('txToFund', () => {
    const tx = new bsv.Transaction()
    get.txToFundInputs.forEach(input => tx.from(input))
    get.txToFundOutputs.forEach(output => tx.addOutput(output))
    return tx.uncheckedSerialize()
  })
  def('purse', () => new MBPurse(get.imb, bsv, get.pmClient))

  describe('when there is no inputs but there is outputs', () => {
    def('txToFundInputs', () => [])
    def('txToFundOutputs', () => [
      new bsv.Transaction.Output({
        script: bsv.Script.fromAddress(address1),
        satoshis: 600
      }),
      new bsv.Transaction.Output({
        script: bsv.Script.buildSafeDataOut(['somedata']),
        satoshis: 0
      })
    ])

    it('returns a tx with one output', async () => {
      const purse = get.purse
      const tx = get.txToFund
      const fundedRawTx = await purse.pay(tx, [])
      const fundedTx = new bsv.Transaction(fundedRawTx)
      should(fundedTx.inputs).have.length(1)
    })

    it('funds the tx with the output returned by imb', async () => {
      const purse = get.purse
      const fundedRawTx = await purse.pay(get.txToFund, [])
      const fundedTx = new bsv.Transaction(fundedRawTx)
      should(fundedTx.inputs[0].prevTxid).be.eql(get.imb.swipes[0].response.txid)
    })

    it('requests the right amount', async () => {
      const purse = get.purse
      const txToFundSize = new bsv.Transaction(get.txToFund).toBuffer().byteLength

      await purse.pay(get.txToFund, [])
      const requestedAmount = Number(get.imb.swipes[0].config.amount)

      const expectedAmount = 600 + // output amount
        Math.ceil((
          txToFundSize + // Size of tx
          160 // ~ Size of extra input
        ) * 0.5) // satoshis per byte

      should(requestedAmount).be.eql(expectedAmount)
    })
  })

  describe('when inputs - size - fee is less between 0 and 547', () => {
    def('txToFundInputs', () => {
      const tx = new bsv.Transaction()
        .to(address2, 500)
      return [
        new bsv.Transaction.UnspentOutput({
          txid: tx.hash,
          vout: 0,
          address: address2,
          satoshis: 500,
          script: bsv.Script.fromAddress(address2)
        })
      ]
    })
    def('txToFundOutputs', () => [
      new bsv.Transaction.Output({
        script: bsv.Script.fromAddress(address1),
        satoshis: 600
      }),
      new bsv.Transaction.Output({
        script: bsv.Script.buildSafeDataOut(['somedata']),
        satoshis: 0
      })
    ])

    it('adds an extra output', async () => {
      const purse = get.purse
      const rawFundedTx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const fundedTx = new bsv.Transaction(rawFundedTx)
      should(fundedTx.inputs).have.length(2)
    })

    it('requests for 547 satoshis', async () => {
      const purse = get.purse
      await purse.pay(get.txToFund, get.txToFundInputParents)
      const request = get.imb.swipes[0].config
      should(request.amount).be.eql('547')
    })

    it('adds the desired output', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      const desiredTxid = get.imb.swipes[0].response.payment.txid
      should(tx.inputs[1].prevTxId.toString('hex')).be.eql(desiredTxid)
    })
  })

  describe('when inputs - fee - outptus is exactly 0', () => {
    def('txToFundInputs', () => {
      const satoshis = 733 // Amount to exactly fund this particular tx.
      const tx = new bsv.Transaction()
        .to(address2, satoshis)
      return [
        new bsv.Transaction.UnspentOutput({
          txid: tx.hash,
          vout: 0,
          address: address2,
          satoshis: satoshis,
          script: bsv.Script.fromAddress(address2)
        })
      ]
    })

    def('txToFundOutputs', () => [
      new bsv.Transaction.Output({
        script: bsv.Script.fromAddress(address1),
        satoshis: 600
      }),
      new bsv.Transaction.Output({
        script: bsv.Script.buildSafeDataOut(['somedata']),
        satoshis: 0
      })
    ])

    it('does not add any output', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      should(tx.outputs).have.length(get.txToFundOutputs.length)
    })

    it('does not add any input', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      should(tx.inputs).have.length(get.txToFundInputs.length)
    })
  })

  describe('when inputs - fee - outptus is between 0 and -547 sat', () => {
    def('txToFundInputs', () => {
      const satoshis = 933 // To fund the tx with extra 200 sats.
      const tx = new bsv.Transaction()
        .to(address2, satoshis)
      return [
        new bsv.Transaction.UnspentOutput({
          txid: tx.hash,
          vout: 0,
          address: address2,
          satoshis: satoshis,
          script: bsv.Script.fromAddress(address2)
        })
      ]
    })

    def('txToFundOutputs', () => [
      new bsv.Transaction.Output({
        script: bsv.Script.fromAddress(address1),
        satoshis: 600
      }),
      new bsv.Transaction.Output({
        script: bsv.Script.buildSafeDataOut(['somedata']),
        satoshis: 0
      })
    ])

    it('does not add any output', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      should(tx.outputs).have.length(get.txToFundOutputs.length)
    })

    it('does not add any input', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      should(tx.inputs).have.length(get.txToFundInputs.length)
    })
  })

  describe('when inputs - fee - outptus is less than -547 sat', () => {
    def('txToFundInputs', () => {
      const satoshis = 30000 // Some big amount to be sure that over fund the tx.
      const tx = new bsv.Transaction()
        .to(address2, satoshis)
      return [
        new bsv.Transaction.UnspentOutput({
          txid: tx.hash,
          vout: 0,
          address: address2,
          satoshis: satoshis,
          script: bsv.Script.fromAddress(address2)
        })
      ]
    })

    def('txToFundOutputs', () => [
      new bsv.Transaction.Output({
        script: bsv.Script.buildSafeDataOut(['somedata']),
        satoshis: 0
      })
    ])

    it('does not add any input', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      should(tx.inputs).have.length(get.txToFundInputs.length)
    })

    it('adds an output', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      should(tx.outputs).have.length(get.txToFundOutputs.length + 1)
    })

    it('sends the money to the right script', async () => {
      const purse = get.purse
      const rawtx = await purse.pay(get.txToFund, get.txToFundInputParents)
      const tx = new bsv.Transaction(rawtx)
      const output = tx.outputs[tx.outputs.length - 1]
      should(output.script.toAddress().toString()).be.eql(get.changeAddress.toString())
    })
  })
})
