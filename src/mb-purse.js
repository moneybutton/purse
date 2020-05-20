const SAT_PER_BYTE = 0.5
const DUST_LIMIT = 547

const calculateCostToFundTx = (tx, parents) => {
  const txSize = tx.toBuffer().byteLength + 160 // It adds the size of the funding input.
  const spentSathoshis = tx.outputs
    .map(o => o.satoshis)
    .reduce((total, current) => total + current, 0)
  const inputSatoshis = parents
    .map(p => p.satoshis)
    .reduce((total, current) => total + current, 0)
  return Math.ceil(txSize * SAT_PER_BYTE) +
    spentSathoshis -
    inputSatoshis
}

class MBPurse {
  constructor (imb, bsv, pmClient) {
    this.imb = imb
    this.bsv = bsv
    this.pmClient = pmClient
  }

  async pay (hexTx, parents) {
    const txToPay = new this.bsv.Transaction(hexTx)
    const satoshisNeeded = calculateCostToFundTx(txToPay, parents)

    if (satoshisNeeded > DUST_LIMIT) {
      return this._addInput(txToPay, satoshisNeeded)
    } else if (satoshisNeeded > 0) {
      return this._addInput(txToPay, DUST_LIMIT)
    } else if (satoshisNeeded > -DUST_LIMIT) {
      return hexTx
    } else {
      return this._addChangeOutput(txToPay, -satoshisNeeded)
    }
  }

  async _addInput (txToPay, satoshisNeeded) {
    const transientKey = this.bsv.PrivateKey.fromRandom()
    const transientAddress = transientKey.toAddress()
    const { payment } = await this.imb.swipe({
      to: transientAddress.toString(),
      amount: satoshisNeeded.toString(),
      currency: 'BSV-SAT'
    })

    const transientTx = new this.bsv.Transaction(payment.rawtx)
    const utxo = transientTx.outputs.find(output => output.script.toAddress().toString() === transientAddress.toString())
    const vout = transientTx.outputs.findIndex(output => output.script.toAddress().toString() === transientAddress.toString())
    txToPay.from(
      new this.bsv.Transaction.UnspentOutput({
        txid: payment.txid,
        vout,
        address: transientAddress,
        satoshis: satoshisNeeded,
        script: utxo.script
      })
    )
    var hashData = this.bsv.crypto.Hash.sha256ripemd160(transientKey.publicKey.toBuffer())
    const inputIndex = txToPay.inputs.length - 1
    const sigtype = 0x01 | 0x40
    const [ signature ] = txToPay.inputs[inputIndex].getSignatures(txToPay, transientKey, inputIndex, sigtype, hashData)
    // signatures.forEach(signature => txToPay.applySignature(signature))
    txToPay.inputs[inputIndex].addSignature(txToPay, signature)
    return txToPay.uncheckedSerialize()
  }

  async _addChangeOutput (tx, changeSatoshis) {
    const { cryptoOperations } = await this.imb.swipe({
      cryptoOperations: [
        {
          name: 'userPaymail',
          method: 'paymail'
        }
      ]
    })
    const userPaymail = cryptoOperations.find(co => co.name === 'userPaymail').value
    const output = await this.pmClient.getOutputFor(
      userPaymail,
      {
        senderHandle: userPaymail,
        signature: 'signature',
        dt: new Date().toISOString()
      }
    )
    tx.to(this.bsv.Script.fromHex(output).toAddress(), changeSatoshis)
    return tx.uncheckedSerialize()
  }
}

export { MBPurse }
