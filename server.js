import express from "express";
import multer from "multer";
import { execFile } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

const app = express();
const PORT = process.env.PORT || 10000;


// =====================================================
// CORS
// =====================================================

app.use((req, res, next) => {

    res.header(
        "Access-Control-Allow-Origin",
        "*"
    );

    res.header(
        "Access-Control-Allow-Methods",
        "GET,POST,OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type"
    );

    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();

});


// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {

    res.json({
        ok: true,
        service: "PikaTools PDF Backend"
    });

});


// =====================================================
// TEST ROUTE — COMPRESS
// =====================================================

app.get(
    "/api/pdf/compress",
    (req, res) => {

        res.json({
            ok: true,
            message: "PDF API route is reachable"
        });

    }
);


// =====================================================
// TEST ROUTE — PROTECT
// =====================================================

app.get(
    "/api/pdf/protect",
    (req, res) => {

        res.json({
            ok: true,
            message: "PDF Protect API route is reachable"
        });

    }
);


// =====================================================
// REQUEST LOGGER
// =====================================================

app.use((req, res, next) => {

    console.log(
        "REQUEST:",
        req.method,
        req.url
    );

    next();

});


// =====================================================
// MULTER
// =====================================================

const upload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize: 25 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {

        const isPdf =
            file.mimetype === "application/pdf" ||
            file.originalname
                .toLowerCase()
                .endsWith(".pdf");

        if (!isPdf) {

            return cb(
                new Error(
                    "Only PDF files are allowed."
                )
            );

        }

        cb(null, true);

    }

});


// =====================================================
// COMMAND HELPER
// =====================================================

function runCommand(
    command,
    args,
    options = {}
) {

    return new Promise(
        (resolve, reject) => {

            execFile(
                command,
                args,
                {
                    timeout:
                        120 * 1000,

                    maxBuffer:
                        10 * 1024 * 1024,

                    ...options
                },

                (
                    error,
                    stdout,
                    stderr
                ) => {

                    if (error) {

                        reject({
                            error,
                            stdout,
                            stderr
                        });

                        return;

                    }

                    resolve({
                        stdout,
                        stderr
                    });

                }
            );

        }
    );

}


// =====================================================
// QPDF OPTIMIZATION
// =====================================================

async function tryQpdf(
    inputPath,
    outputPath
) {

    console.log(
        "STARTING QPDF QUICK OPTIMIZATION..."
    );

    try {

        await runCommand(
            "qpdf",
            [
                "--stream-data=compress",
                "--compress-streams=y",
                "--object-streams=generate",
                inputPath,
                outputPath
            ]
        );


        const output =
            await fs.readFile(
                outputPath
            );


        console.log(
            "QPDF OUTPUT SIZE:",
            output.length,
            "bytes"
        );


        return output;

    } catch (result) {

        console.error(
            "QPDF FAILED"
        );

        console.error(
            result?.stderr ||
            result?.error?.message ||
            "Unknown qpdf error"
        );


        return null;

    }

}


// =====================================================
// GHOSTSCRIPT SETTINGS
// =====================================================

function ghostscriptArgs() {

    return [

        "-sDEVICE=pdfwrite",

        "-dCompatibilityLevel=1.4",

        "-dPDFSETTINGS=/screen",


        // ---------------------------------------------
        // COLOR IMAGES
        // ---------------------------------------------

        "-dDownsampleColorImages=true",

        "-dColorImageResolution=96",

        "-dColorImageDownsampleType=/Average",


        // ---------------------------------------------
        // GRAYSCALE IMAGES
        // ---------------------------------------------

        "-dDownsampleGrayImages=true",

        "-dGrayImageResolution=96",

        "-dGrayImageDownsampleType=/Average",


        // ---------------------------------------------
        // MONOCHROME IMAGES
        // ---------------------------------------------

        "-dDownsampleMonoImages=true",

        "-dMonoImageResolution=150",


        // ---------------------------------------------
        // JPEG COMPRESSION
        // ---------------------------------------------

        "-dAutoFilterColorImages=false",

        "-dColorImageFilter=/DCTEncode",

        "-dAutoFilterGrayImages=false",

        "-dGrayImageFilter=/DCTEncode",

        "-dJPEGQ=65",


        // ---------------------------------------------
        // PDF OPTIMIZATION
        // ---------------------------------------------

        "-dDetectDuplicateImages=true",

        "-dCompressFonts=true",

        "-dSubsetFonts=true",


        // ---------------------------------------------
        // GHOSTSCRIPT
        // ---------------------------------------------

        "-dNOPAUSE",

        "-dQUIET",

        "-dBATCH"

    ];

}


// =====================================================
// GHOSTSCRIPT
// =====================================================

async function runGhostscript(
    inputPath,
    outputPath
) {

    console.log(
        "STARTING GHOSTSCRIPT SMART COMPRESSION..."
    );


    const args = [

        ...ghostscriptArgs(),

        `-sOutputFile=${outputPath}`,

        inputPath

    ];


    console.log(
        "GHOSTSCRIPT ARGS:",
        args.join(" ")
    );


    await runCommand(
        "gs",
        args,
        {
            timeout:
                120 * 1000
        }
    );


    const output =
        await fs.readFile(
            outputPath
        );


    console.log(
        "GHOSTSCRIPT OUTPUT SIZE:",
        output.length,
        "bytes"
    );


    return output;

}


// =====================================================
// SEND PDF — COMPRESS
// =====================================================

function sendPdf(
    res,
    file,
    buffer
) {

    const compressed =
        buffer.length < file.size;


    const safeName =
        file.originalname
            .replace(
                /\.pdf$/i,
                ""
            )
            .replace(
                /[^a-zA-Z0-9._-]/g,
                "_"
            );


    res.setHeader(
        "Content-Type",
        "application/pdf"
    );


    res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}${
            compressed
                ? "-compressed"
                : ""
        }.pdf"`
    );


    res.setHeader(
        "X-Original-Size",
        String(file.size)
    );


    res.setHeader(
        "X-Compressed-Size",
        String(buffer.length)
    );


    console.log(
        "SENDING PDF TO CLIENT..."
    );


    res.send(buffer);


    console.log(
        "PDF RESPONSE SENT"
    );

}


// =====================================================
// PDF COMPRESS API
// =====================================================

app.post(
    "/api/pdf/compress",
    upload.single("file"),

    async (req, res) => {

        let inputPath = null;
        let qpdfPath = null;
        let gsPath = null;


        try {

            console.log(
                "MULTER FINISHED"
            );


            // -----------------------------------------
            // CHECK FILE
            // -----------------------------------------

            if (!req.file) {

                console.log(
                    "NO PDF FILE RECEIVED"
                );


                return res
                    .status(400)
                    .json({
                        error:
                            "No PDF file received."
                    });

            }


            console.log(
                "PDF RECEIVED:",
                req.file.originalname
            );


            console.log(
                "PDF SIZE:",
                req.file.size,
                "bytes"
            );


            // -----------------------------------------
            // TEMP FILE PATHS
            // -----------------------------------------

            const id =
                crypto.randomUUID();


            inputPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-input.pdf`
                );


            qpdfPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-qpdf.pdf`
                );


            gsPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-gs.pdf`
                );


            await fs.writeFile(
                inputPath,
                req.file.buffer
            );


            console.log(
                "PDF SAVED TO TEMP FILE"
            );


            // =================================================
            // STEP 1 — QPDF
            // =================================================

            const qpdfOutput =
                await tryQpdf(
                    inputPath,
                    qpdfPath
                );


            let qpdfReduction = 0;


            if (qpdfOutput) {

                qpdfReduction =
                    (
                        (
                            1 -
                            qpdfOutput.length /
                            req.file.size
                        ) * 100
                    );


                console.log(
                    "QPDF REDUCTION:",
                    qpdfReduction.toFixed(2),
                    "%"
                );

            }


            // =================================================
            // STEP 2 — QPDF RESULT IS GOOD ENOUGH
            // =================================================

            if (
                qpdfOutput &&
                qpdfReduction >= 2
            ) {

                console.log(
                    "SMART COMPRESSION:"
                );

                console.log(
                    "QPDF PROVIDED MEANINGFUL REDUCTION"
                );


                console.log(
                    "RETURNING QPDF RESULT"
                );


                return sendPdf(
                    res,
                    req.file,
                    qpdfOutput
                );

            }


            // =================================================
            // STEP 3 — GHOSTSCRIPT FALLBACK
            // =================================================

            console.log(
                "QPDF REDUCTION TOO SMALL."
            );


            console.log(
                "STARTING GHOSTSCRIPT FALLBACK..."
            );


            try {

                const gsOutput =
                    await runGhostscript(
                        inputPath,
                        gsPath
                    );


                // -----------------------------------------
                // Ghostscript reduced the PDF
                // -----------------------------------------

                if (
                    gsOutput &&
                    gsOutput.length <
                    req.file.size
                ) {

                    console.log(
                        "GHOSTSCRIPT REDUCED PDF"
                    );


                    console.log(
                        "FINAL SIZE:",
                        gsOutput.length,
                        "bytes"
                    );


                    const reduction =
                        (
                            (
                                1 -
                                gsOutput.length /
                                req.file.size
                            ) * 100
                        );


                    console.log(
                        "FINAL REDUCTION:",
                        reduction.toFixed(1) + "%"
                    );


                    return sendPdf(
                        res,
                        req.file,
                        gsOutput
                    );

                }


                // -----------------------------------------
                // Ghostscript didn't reduce it
                // -----------------------------------------

                console.log(
                    "GHOSTSCRIPT DID NOT REDUCE SIZE"
                );


                if (
                    qpdfOutput &&
                    qpdfOutput.length <
                    req.file.size
                ) {

                    console.log(
                        "RETURNING QPDF RESULT"
                    );


                    return sendPdf(
                        res,
                        req.file,
                        qpdfOutput
                    );

                }


                // -----------------------------------------
                // Neither method reduced it
                // -----------------------------------------

                console.log(
                    "NO SMALLER VERSION FOUND"
                );


                console.log(
                    "RETURNING ORIGINAL PDF"
                );


                return sendPdf(
                    res,
                    req.file,
                    req.file.buffer
                );


            } catch (gsError) {

                console.error(
                    "GHOSTSCRIPT FAILED:"
                );


                console.error(
                    gsError?.stderr ||
                    gsError?.error?.message ||
                    gsError?.message ||
                    gsError
                );


                // -----------------------------------------
                // QPDF fallback
                // -----------------------------------------

                if (
                    qpdfOutput &&
                    qpdfOutput.length <
                    req.file.size
                ) {

                    console.log(
                        "GHOSTSCRIPT FAILED."
                    );


                    console.log(
                        "RETURNING QPDF RESULT"
                    );


                    return sendPdf(
                        res,
                        req.file,
                        qpdfOutput
                    );

                }


                // -----------------------------------------
                // Original fallback
                // -----------------------------------------

                console.log(
                    "RETURNING ORIGINAL PDF"
                );


                return sendPdf(
                    res,
                    req.file,
                    req.file.buffer
                );

            }


        } catch (error) {

            console.error(
                "========== PDF API ERROR =========="
            );


            console.error(
                error
            );


            console.error(
                "==================================="
            );


            if (!res.headersSent) {

                res
                    .status(500)
                    .json({
                        error:
                            error?.stderr ||
                            error?.message ||
                            error?.error?.message ||
                            "PDF compression failed."
                    });

            }


        } finally {

            // -----------------------------------------
            // CLEAN TEMP FILES
            // -----------------------------------------

            if (inputPath) {

                await fs
                    .unlink(inputPath)
                    .catch(() => {});

            }


            if (qpdfPath) {

                await fs
                    .unlink(qpdfPath)
                    .catch(() => {});

            }


            if (gsPath) {

                await fs
                    .unlink(gsPath)
                    .catch(() => {});

            }


            console.log(
                "TEMP FILE CLEANUP COMPLETE"
            );

        }

    }
);


// =====================================================
// PDF PASSWORD / PROTECT API
// =====================================================

app.post(
    "/api/pdf/protect",
    upload.single("file"),

    async (req, res) => {

        let inputPath = null;
        let outputPath = null;

        try {

            console.log(
                "PDF PROTECT REQUEST RECEIVED"
            );


            // -----------------------------------------
            // CHECK FILE
            // -----------------------------------------

            if (!req.file) {

                return res
                    .status(400)
                    .json({
                        error:
                            "No PDF file received."
                    });

            }


            // -----------------------------------------
            // CHECK PASSWORD
            // -----------------------------------------

            const password =
                typeof req.body?.password === "string"
                    ? req.body.password
                    : "";


            if (!password) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Password is required."
                    });

            }


            if (password.length < 4) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Password must be at least 4 characters."
                    });

            }


            if (password.length > 128) {

                return res
                    .status(400)
                    .json({
                        error:
                            "Password must not exceed 128 characters."
                    });

            }


            console.log(
                "PDF RECEIVED:",
                req.file.originalname
            );


            console.log(
                "PDF SIZE:",
                req.file.size,
                "bytes"
            );


            // -----------------------------------------
            // TEMP FILES
            // -----------------------------------------

            const id =
                crypto.randomUUID();


            inputPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-protect-input.pdf`
                );


            outputPath =
                path.join(
                    os.tmpdir(),
                    `pikatools-${id}-protected.pdf`
                );


            await fs.writeFile(
                inputPath,
                req.file.buffer
            );


            console.log(
                "PDF SAVED FOR PROTECTION"
            );


            // -----------------------------------------
            // RANDOM OWNER PASSWORD
            // -----------------------------------------

            const ownerPassword =
                crypto
                    .randomBytes(32)
                    .toString("hex");


            // =================================================
            // QPDF PASSWORD ENCRYPTION
            // =================================================

            console.log(
                "STARTING QPDF PDF ENCRYPTION..."
            );


            await runCommand(
                "qpdf",
                [
                    "--encrypt",

                    password,

                    ownerPassword,

                    "256",

                    "--",

                    inputPath,

                    outputPath
                ],
                {
                    timeout:
                        120 * 1000
                }
            );


            // -----------------------------------------
            // READ PROTECTED PDF
            // -----------------------------------------

            const protectedPdf =
                await fs.readFile(
                    outputPath
                );


            if (
                !protectedPdf ||
                protectedPdf.length === 0
            ) {

                throw new Error(
                    "Protected PDF could not be created."
                );

            }


            console.log(
                "PROTECTED PDF SIZE:",
                protectedPdf.length,
                "bytes"
            );


            // -----------------------------------------
            // SAFE DOWNLOAD NAME
            // -----------------------------------------

            const safeName =
                req.file.originalname
                    .replace(
                        /\.pdf$/i,
                        ""
                    )
                    .replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );


            // -----------------------------------------
            // RESPONSE HEADERS
            // -----------------------------------------

            res.setHeader(
                "Content-Type",
                "application/pdf"
            );


            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${safeName}-protected.pdf"`
            );


            res.setHeader(
                "X-Original-Size",
                String(req.file.size)
            );


            res.setHeader(
                "X-Protected-Size",
                String(protectedPdf.length)
            );


            console.log(
                "SENDING PROTECTED PDF..."
            );


            res.send(
                protectedPdf
            );


            console.log(
                "PROTECTED PDF RESPONSE SENT"
            );


        } catch (error) {

            console.error(
                "========== PDF PROTECT ERROR =========="
            );


            console.error(
                error?.stderr ||
                error?.error?.message ||
                error?.message ||
                error
            );


            console.error(
                "======================================="
            );


            if (!res.headersSent) {

                res
                    .status(500)
                    .json({
                        error:
                            error?.stderr ||
                            error?.error?.message ||
                            error?.message ||
                            "PDF protection failed."
                    });

            }


        } finally {

            // -----------------------------------------
            // CLEAN TEMP FILES
            // -----------------------------------------

            if (inputPath) {

                await fs
                    .unlink(inputPath)
                    .catch(() => {});

            }


            if (outputPath) {

                await fs
                    .unlink(outputPath)
                    .catch(() => {});

            }


            console.log(
                "PROTECT TEMP FILE CLEANUP COMPLETE"
            );

        }

    }
);


// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "GLOBAL ERROR:",
            error
        );


        if (!res.headersSent) {

            res
                .status(400)
                .json({
                    error:
                        error.message ||
                        "Request failed."
                });

        }

    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `PikaTools PDF backend running on port ${PORT}`
        );

    }
);