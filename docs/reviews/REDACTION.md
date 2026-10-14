# Redaction of recorded evidence

Date: 2026-10-14

The repository is public. Machine paths and the name of a private project were removed from recorded evidence. Evidence integrity was kept: files whose exact bytes are the evidence were not touched, and every changed file has its old and new SHA-256 recorded below.

## Rule

- Absolute paths under the original home directory were replaced with placeholders, longest prefix first.
- The private project name, in any letter case, was replaced with a placeholder; its domain was replaced with a separate placeholder.
- The directory that carried the project name in its own name was renamed. Its contents were not otherwise reordered.
- Raw-byte files were left unchanged even where they still contain a path or the name. These are: files marked `-text` in `.gitattributes`, `*.ndjson`, `*.jsonl`, `*.stat`, and any file whose SHA-256 is recorded as a patch or artifact hash in another evidence file.
- Every `SHA256-MANIFEST.json` was recomputed for the files rewritten here. Entries for raw files are unchanged.
- Other recorded hashes were not edited. Hashes that describe pre-redaction text inside a rewritten file are listed in the section on embedded hashes.
- Git history keeps the original files. This redaction applies to the current tree only.

## Placeholders

| Original | Placeholder |
| --- | --- |
| Supervisor private home directory | `<private-supervisor-home>` |
| Vibe uv tool environment | `<vibe-tool-env>` |
| Node version manager home | `<nvm-home>` |
| Supervisor repository checkout | `<supervisor-repository>` |
| Site project repository checkout | `<site-project-repository>` |
| Any other path under the original home directory | `<target-home>/...` |
| Private project name, any letter case | `<site-project>` |
| Private project domain | `<site-project-domain>` |
| Private project root placeholder used in a runbook | `<site-project-root>` |
| Directory named after the private project | `site-project-release-gap-followup-2026-10-13` |

## Counts

- Evidence and prose files rewritten: 112
- Manifests updated: 6 found, 6 updated with new entries
- Raw files left unredacted that still contain a path or the name: 25

## Rewritten files

| Path | Old SHA-256 | New SHA-256 |
| --- | --- | --- |
| `docs/history/connection-strategy-2026-10-12.md` | `912fd54fc3ae04398d5d0973af560a403706ce32c6ecbd82c51d11a654609a0d` | `b1680c63b099e435f88feb7f25a329bfaf4df7b98f64f953d11741dbfd780e2f` |
| `docs/history/rc20-compatibility-2026-10-10.md` | `dd7883754edc603a7952faa8235435016b9aae6ba65eaf7c3c7a5d79337b1723` | `71aab0c097f9b50889131d031bd6fa89f2b1fa7b6b30f21497f819d58e66dc09` |
| `docs/history/rc28-target-brief.md` | `be010e5f599b5a6d746bb6beee4b3064c4f09bcd6d10ff4f8540b5e55b45e18e` | `268da0ea8046eeddc1f4ddebeae342ceade51275e7a0afad76895994ce8dd38d` |
| `docs/history/rc28-target-runbook.md` | `7a08fd1baf6f32652fa9e296e49d0052372fd023bf40150446203414a877fec9` | `a2d02dcbd6e79dfeef1d48791a6ce8541a8850c5eef1a5857eb93043453b4af9` |
| `docs/history/reviews/phase-d-template/Read.md` | `577dfaec2e3225e5a16f4ecc812e0adedbe5dbdcd0c7f06cf0efea208caefc19` | `f882d11bf3a0579fe54b9782e53080285ff0d3972a57d00043b63fd1cb957ffb` |
| `docs/history/reviews/rc18-release-installation-2026-10-09.md` | `a24088a69b704386738eb6ef8011294c1df721c08c56996cc52078d01abccd00` | `33d4420e8526096a124f9b1798d180b5085e4ea7a000a10f4d94cac715165468` |
| `docs/history/reviews/rc28-target-test-2026-10-13/RUNBOOK.md` | `0bc1b23db6786ea49996b1adec5430ced5b2e339e51a084c0180f34a1f83af8a` | `a45b36c9e810684493c5262bb34ba47a13ee75544d85419b7dbcb8f1d766e348` |
| `docs/history/reviews/rc28-target-test-2026-10-13/native-readiness.json` | `81eec17fb8203e068c4b03e9a9dcf474b0410c845813c65a341f0d428bdeb24b` | `758636b66da14bf981e472b44c052b841cc89992fceb38e03aec129967b2c9fd` |
| `docs/history/reviews/v1-confirmation-2026-10-13/REPORT.md` | `e001abb9aa2c847a5d68750a6d74864493dfb72815098c52d5da1e91c28d16c7` | `cce71f96697e842f9fdd2c5837738684e27f7960852c7b4f0e18224cb2533d70` |
| `docs/history/reviews/v1-readiness-assessment-2026-10-12.md` | `2f14a966bdae9d08792464ce0dd2fc264e468535065dd525116125dab52ba3e7` | `ebfbdc5f96da3b1c644a740e3bdca6d89360f9f954141f62ee10a21fd636e963` |
| `docs/reviews/practical-tool-access-1.0.1-rc.1.md` | `fa669aebd046c16c52efe416de699fae1fc4f03011a90501a7ab84995ca65ff6` | `98e20c483667b1272c850659f3e6c449f4877aea7b8a4756e28852cb6ebb16b5` |
| `docs/reviews/practical-tool-fix-2026-10-13/RC1-RESUME.json` | `67f403978b83e4feb82a23613ae7ab396d47d8e7f0dad4a745400586dd0e80d7` | `797bc932c83ee9799221b9d25b6d017b04ebbd26a4187d73ad5b5d67494bb82f` |
| `docs/reviews/practical-tool-fix-2026-10-13/REPORT.md` | `b32c43d48b2d97a4a0b8273b2ebd3e0525fe34aacb88379187fde3ddcc5ada94` | `9d6c976209a5e65c8401db9bf21db0aa82266c896861d245ff065477c612c79b` |
| `docs/reviews/practical-tool-fix-2026-10-13/current-installed-readiness.json` | `a54e73c15ec2da8eabfa68cb16df35cb73086cea4817f612dbe4a8adf121495c` | `e4e04ad4739eb09ffedc1a069629d0a90895d75c351a045732e35f70fe05225e` |
| `docs/reviews/practical-tool-fix-2026-10-13/performance/vsup_perf_driver.mjs` | `97c8f5d507ed4eda1be5fa9cf97a09be429e426c93f190a4db2354881ca3c5c9` | `af19a43fbb4f3fa26da8dfcb4ee223923260f0a50f3d0dddba6de5c8e1208872` |
| `docs/reviews/practical-tool-fix-2026-10-13/post-registration-readiness.json` | `45541b8ce6fee68c93795781c061a1953b3d74a37c8a4b5a577e532db2d99271` | `4e7b7c7a78dc1c59278db89a3e02f05fe10499afe0c2193f2aaa9756173901b2` |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-access-1.0.1-rc.1.md` | `d7e7627ca846eed10e6c6f6d2ce92c0e25ed03cc6244f345515841f435132f61` | `45f3655c4f0f6d55240c3de5f6818507db28fe8099c0cc3fc7ea157f2188ee56` |
| `docs/reviews/practical-tool-fix-2026-10-13/rc1-completion-audit.md` | `2f6d96ffa044159909ea70c8179964cf4155cf72578a06a279e3c2b148f4e96a` | `e862b3918e555e1ead8cf2b52bc2e65dc515639a897594317fe18b6de6252628` |
| `docs/reviews/practical-tool-fix-2026-10-13/rc1-installation-proposal.json` | `81a50adf60f29784af1a4ef21b8b10027ae0b2cf735e5145297fe2a676fba4f3` | `7186387874a05d79516da3296685e3081eb28ec0761cd6ec181cc4d82dd1c4ad` |
| `docs/reviews/practical-tool-fix-2026-10-13/rc1-installed-doctor.json` | `45800670906a5c98431b64159087b37b9ba39b0e19b0ccb7529009c87bfcf690` | `9da1b88db7677646e9f12bcf76cc27b913f66aef3add436aed4cad151c5e6dac` |
| `docs/reviews/practical-tool-fix-2026-10-13/rc1-installed-files.json` | `40fced9d5621f20ef0044081583754d42d252ab4ba54b4913daf831071259e05` | `1404da2cba32fd013fd12b05907ab265a361fda3860fed77223ec196db8ec0f7` |
| `docs/reviews/practical-tool-fix-2026-10-13/rc1-node20-supplement.json` | `441e9c62495cc880a3de7eea1eafd04ff05ef65e62467493a14d1c56ae26afe1` | `68fa0e1305acd246088dcb5d06fef399fbb92d7c9434444e037d145c830d390a` |
| `docs/reviews/practical-tool-fix-2026-10-13/rc1-registration-receipt.json` | `7ef106883fbc7b4254e7bada4ec3f02cebba198f72f4da8c2c2812746e85a3fd` | `73b00656fee7c1b73246279b692331a622d9de4634897e89277658773eb99ef4` |
| `docs/reviews/rc1-hosted-2026-10-14/ARCHIVE-REPLAY.md` | `9b8583d2763974b37d51d34d82365b029e8918b10b7aef9311b8bb501f2eb3f2` | `804b8111c6779aac8d94f7b7379293ecdd37e4608fdc05f9c7755548dcaba153` |
| `docs/reviews/rc1-hosted-2026-10-14/REPORT.md` | `cbb0c0c7df39037e67e16677896c9baf48042ce054a78aac58bddb8e756e5d10` | `6931ea57f0372aaa95d6f2c1c79534efd94134916eaa1b6e6356077b75388243` |
| `docs/reviews/rc1-hosted-2026-10-14/case1-result.json` | `d3f3f9f340e6427039c48d3c107e0bc393ab359d81aa1ef754d5917b731bee3a` | `c89a59778c5c26ce1b57a58211e92d3521ae65fa12ed24b8d6fa24b3dd0c2c02` |
| `docs/reviews/rc1-hosted-2026-10-14/case1-start.json` | `73686d824f92f19b81154b29af67770a2ed313746921905c0c8b4778ec390f17` | `cc54eb34ddfbd5003148b1ddb04dd008a514149beb15b4d352a9f86ced40f609` |
| `docs/reviews/rc1-hosted-2026-10-14/case2-close.json` | `7bff79cec3ddfc07a1f4e3fd840fd23a8be5ec2a96b977af9d4d58c41e312218` | `5cf03ba59f9d06123638ab87b49710b030c612df7f81cea245e6a37016ee5659` |
| `docs/reviews/rc1-hosted-2026-10-14/case2-result.json` | `a2c4253004a190d8f64a4c371b22a48a7079b27337b9ebfc5c422247b4bb3ac2` | `09c61f2e83eacace20f5d3f7d365ffd852dc1c7687aee352e1110de676dab3bf` |
| `docs/reviews/rc1-hosted-2026-10-14/case2-start.json` | `214682f68d1631eeefb6c9245742927328a15c3a6108543d7b0315ca86f99a93` | `0536c1da669e9c5f1477e3cd76701a26945c6333eb10ce95a0804e69d425b00b` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-CRLF-record.json` | `3a59a710ffa750aded249656d7b4629dc1b946c296e00c1c7281d9483af89c45` | `4575d8e88e9900f512cce634d3706041ec1825c96188f5d3fdd099bc5a1c3e2e` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-absolute-filename.json` | `a38ba84d74bdbf3833e6e258de908326aa380723dbd63a8a86799374f8c3fb50` | `b91c29cfff4c76f1b4e64dea4327aaf193394d36f35762a16f7acc12c3fefff1` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-corrupt-digest.json` | `e106c841ad5dc0914ae4b23ec10b0fe8081932e23a07d02045250241ba958413` | `45a8a85249360382141ed5821ce44a55629724bc28fbb97ab4013042dd84699b` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-extra-blank-line.json` | `997c0302b6ccd523fb093ddba57bab67b5d209527423f63c7f50e12618b06725` | `4b99bbb921e9bdf40997316b9ab21b814bc4fcd2a1d7e38c1a6e69d4b5aacbfb` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-extra-records.json` | `60e1f55a93162a729321372d874c3eddee915b3b0a54dc75e23a01a61cb1b681` | `fa8b3878f4deb337d06260a0b7c0afb596bd752dc9c0eda4e0ea7b0b59d5897c` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-malformed-digest-record.json` | `f27f69b2bdb5099e8dcb9059fbbb1c7278b01113a15b606cade20af983ce4c6c` | `f40d54bd8d84d4e29c68f82aac53bfcc02f100f1d9b053f0c4c4fa934e4bf3f4` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-missing-final-LF.json` | `b3ffd7e3372585a406a56ea94dbab688f6f36c50855fd609a9fc0044b92aab3f` | `2cbf8b8f0b2e5e9ffde2ac169f64e08ac791c1978c6a2c33eb5ad66dc62759e6` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-short-digest.json` | `c2db68a5e1e62db1396e3bf5e2b18f0a9a270b54dd29199cc0fb293aeb93812d` | `76854b4c93ff1c98a78ddd0653ce3828f9679108c68ae8f689a2c68a988f8793` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-traversal-filename.json` | `ca625f1b8360623bc665807faa230209ea76e05ec499944c0b2fe34289c9e5a7` | `0b1da4a9b4e18a1dd896108f82b4ddda8bf57efd484d00b83e4a2fd30e462aa4` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-uppercase-digest.json` | `0f472d1cfa7076dc72d111c4679259cf14732e2edb1d7cabb20f97d3c51b4694` | `c6256e731179b504cafed6a859ae6b3bfb4fdcf985b017d329f0821f0ac104a2` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/checksum-wrong-release-basename.json` | `58a5828290ca49a076c38fa991f94197bbdc53a08b251805f2e62bc258e4f69d` | `a0ff4c8d5035280d069ac50ea140305c9f317df3abe9bfb020aba20bf1b068c6` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/invalid-format-matching-checksum.json` | `e6952f5fd868587cb262af281f196fd35e7ae5f1f7727913841a3edb8a7c9923` | `8e14440570bd4817dc3cd3df0ef802cb72bc26f99dabe5c3cae436a2070dc43a` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/producer-format-success.json` | `89d78b680443066e0e6075a4d10bd05e1066339a469e87fd9f25ef9719dacccd` | `986f90822dd95460b0960e4ad7b84bbb8add78f8b8c653c09252ad99ee9ce815` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/provenance-mismatch.json` | `1f1635ffcee36c2cbe58f94549b24a6c586737423b93533e11f23e940f78af9f` | `d49e4ed2cb1b5e34fc028f095ae35c590f04236a3dd1cc00ca3d1fddf1745f48` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/tampered-archive-original-checksum.json` | `93198acdc7dcc79a5726552df3792c3e28182b174adaa0ee7d1977534700ecdc` | `b982be648dd02a96260aa0c0a5832c8885fc75a5988c7b4ab284a82f7eb2e541` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-CRLF-record.json` | `957abcb2fd6e8f9a95dbb4c883e7668689dc81be4f33af3861e18467a723aef5` | `8ad3fa367207437f0777d2bc7620f773b8c5f06cd22e5529c3988d4746b45e6d` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-absolute-filename.json` | `462b258644a54ebe97caf4e569ee4adf4190207193978cee8d137e5e85c75406` | `6f24cf08721eb56775a91fad766181b6edc86617714ab6884d3bd9b7989189e8` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-corrupt-digest.json` | `644313c1b17e3f46c4000467a3e482fc5892b8e3aab4efee84d2dd24d132e94f` | `7aca014b6a3a653ba8d80ad212f8fa8f122360a36b6468e1730f86799dd7f925` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-extra-blank-line.json` | `2599c004df5a8d2e8913a831a45b8f575ff9ca03108d112ac037a89152de3cdf` | `f0b488bd490b71df254dfb070abe15da48b274baa596bb7aa6679d68034ca5e1` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-extra-records.json` | `8b7e473e697bcb2b00e5dc469432239e5be8644e8b47a70013b8ce085a8343d7` | `71b44cfb2cdc10234075770f5ea37aa8da141bd15ba6f474874df5625d7f758e` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-missing-final-LF.json` | `6f6daa1f9bb8dbc64ee3f29cce122b4ab7dd04b2a9c6e5606b290eb44910e3b4` | `2eaf765696aa51b66e09e66b9623a143db5031a92e779cf4e92bb4352156c307` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-traversal-filename.json` | `a6e6d600d7811dd3547d8d5333b2e997bc081c5dd54597772f9b68669a8eadb4` | `850914069a20a9abeef00094911f0209013257b0ff8a29fd5afd661b87c4ce7b` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-uppercase-digest.json` | `ad1617c3d368975f9aa9950a07e4401b7b2756ffcca85aacf2115c4934735037` | `4043a0243ee53577c92ae8320895e3373ef98e9e48ab188e4bf9fb62ac940cb1` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/checksum-wrong-release-basename.json` | `3f7d087c182a573ce0c2a2ded87908e5c0dd2a567e9bf3ae822efb32db5029bf` | `0e8dc9f11df94fff55c465a05897667085f31e786f493fcab95b300babbf6d6c` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/invalid-format-matching-checksum.json` | `3639e55e0016c60cc927c2750770ecbe47ed9da2d5bbb12fbb3659f98856199f` | `2c45abf28e4393ae4eb3fb975faa97621abb94c2e7b0ce63c72884fa85d21fd4` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/producer-format-success.json` | `5384dbd545965ea58793548dfe49d474ba45f3b5eac48e7598f9dda9790d552f` | `7050360fbf2c4186c3b2c459c64dd53fe77371f73b94fa01e4221e9834a5a5f3` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/provenance-mismatch.json` | `a3b7c1c73c0e90ccb0568499b89a5c86b4c267e1935f30717a0b099bdf58136b` | `1288f81a3c151b873fb8fb1e8d4fa8333c8c7ca8d96904f1b62f134d8fdf4ccf` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures/tampered-archive-original-checksum.json` | `b85825ad1de4f8f3a4ed051b3a0be5ff501b4a702d5dd91ab5eeca1b4bfae544` | `406769445970ae213279962bbf6fdeb4cf9475c43948fb59220e5582969850d4` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/independent-edge-fixtures/independent-trailing-carriage-return.json` | `845ef810b6ab92db10853fef7d9f07f3f7297fe151c8bf4fbc985fadfedc1bdc` | `673a5ebbbf5e48c3735dfba2129a8fb843cb4c9b932ade352bedf307a6fcb5cb` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/independent-edge-fixtures/independent-trailing-junk.json` | `6766a4a04ccdb59a2c79c5b79325aeea467ebbbced6f38e2be0b1dac83da0fba` | `84c192c7fca9a2b25f9fa7502f5de0557e21f8a7105c7f5beda5da8e148cec46` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b-close.json` | `d7e24035aeadd31f87bfe8f5e3caa582dca88c976c10f6f3b80e2fbb72325390` | `79aa2673bf02d8e9262f6ea13a0ef3b27eb62e5100c7b0198936f5983df50510` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b-result.json` | `e33b3fd9ad2b8fc7ab73cd09bb2af0944acce6979dc637f2bf2dd5449f43549f` | `3b1251d1d58e8a39e48a377bac465dcdef780b81cd5219fe49dec74e94ee054e` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b-start.json` | `003d1021287f51625131604e3afc1bba2fe42f263cef5497e63d35dcdbc582dc` | `53150bfe9947f124ae897a837a32eff4364d817e2a80bc74dc9bdf1c0d96c7c2` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-CRLF-record.json` | `72ef815e0929a5121549a5c8d641cb246055b53d7a4d14720ea6b16f49225268` | `c970c37066a9abd1f2aba8c6c539a3e8bc0a6e3b7f87d7f1a0a20c1a039091c5` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-absolute-filename.json` | `b7a457a42845e93e4ee0b4539b6ce22ba177910889b332cfa046cd45424b82fa` | `801aa923beab1904729ac0410345ca5509917ca2ce94a52f37283aa03939a598` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-corrupt-digest.json` | `802ee6de1b5e6ef4879dd94b4db8058475929ae858bb14fc262551610bb1e8a4` | `0f3ec0f8e05c471c66fa51a039dcdb27b55874144a16c72d7e36307fa34f5abc` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-extra-blank-line.json` | `1d706b55bc3461286b66e688e137dd07ea4873316873c8b9231cd61d57aed683` | `f28b24140dcd3a5bc5718606e36f13c1f431ce432417a1cc59f0380e0aa132e1` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-extra-records.json` | `3aa906973fcc77d09c2875f628da1e8313dd81bc68ad387130fc8f377328f4c3` | `eb73e357c45a2f6bee3209837721ed9507a95e4fdb94db63643fd9a1bd8b9683` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-malformed-digest-record.json` | `e863d86825df6ddd8b313cf1a2b03cbbef9d9461085cbabe0be43bb55d11a854` | `f17dfe5889744db844404b708b89062a098c852e86f427585bf9c6dbf4c92c44` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-missing-final-LF.json` | `67e152bc820cd23298e6b29f8edcccbf03b8655eacd15c89563bf11ee24b15cc` | `6408568d7df1c155a40017a3d0c7afee198b4f1ee78b5ec49ea9f435a8c51d3f` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-short-digest.json` | `6fa4bb838e3e0f203ae1dc98b94644abe5505a5ea28f5fac5a9a54a3f5803edb` | `5f887167e5e636b68b4060f72991277420458f781b59c07e063594b3816b20ce` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-traversal-filename.json` | `2d63aec06d2dffc8760b6b192e8f0743b8b7ac9f52d83140d501f95bb074e8fa` | `2d380256303e9f06acb009ca4926cbc2b6b735f1155a93434d3fccc8c5a3772f` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-uppercase-digest.json` | `78896c56ca1eb969ac30626cdaf61aacf40baa6fdf7be378c5d8f87878282fdb` | `97f96761d29eb5829aba4aee7120a8d7816eff83d50dc5c8e69973f2251f8c10` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/checksum-wrong-release-basename.json` | `9b243246874b9af2f29c81c07f6644d792bc890e6bb1dc5f03fb56c9bcb89d52` | `061a1dd0c6a16a40506f0359a4c52ec6b51dfc1ed36972da2fdaac671d172245` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/independent-trailing-carriage-return.json` | `8a2ad9fe84e1aefdc12ceacf0beb1ec134c013d98ab80d82b0370dbe7b0b83a4` | `c1aa73e66cc0d362a5d85f5c2f2c210a8f5fa23a27514c961fc63d5771c95dad` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/independent-trailing-junk.json` | `77fa0aa7d3fff9d514fee4a31a263447d52ca298e0dc69cbc781f899e17dfac9` | `f6013b832f0a343a81725c0a44fa11600b19c9ae91143caeeda271f7e2a1f3de` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/invalid-format-matching-checksum.json` | `c27f3584a8d09f7dcf7d353e7c8bca50745d687d7f0227016ccd2f8a0ebdd37b` | `e6d769d03a319d08dfc59adc1209f29eb924dedfd958cc74719eb015d5b3aea5` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/producer-format-success.json` | `7fe2379f2431624f623378854ef73e375ef5aa5660ad3c776a5b0c8f70f53773` | `2d3e2e933448a09ba865b353b1151ddbb7702ac241582816bafe5406d5c5dedd` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/provenance-mismatch.json` | `98ded81bb17376d562425f01633c5291a24ae4989afcd8a9c3ebec7179153f0d` | `ac73c73cc47670eb7eeef0ae2f41b99d7a1935615d4d54d89e807ebe4d4a0517` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/tampered-archive-original-checksum.json` | `1f2407a76de389a8f5f4d913b8583bf3c7c0a9dc6a82c750c9f715b281240371` | `162cd30b55f940b96134cddef4eb0d5d6eb6a439febbeee705b3aa37046af2da` |
| `docs/reviews/rc1-hosted-2026-10-14/case3-result.json` | `1fb86238489d11c9b9d4c48fa98d6614acd8a2f76aaf7cba43149a32b9145412` | `a49a8e4e9bde4ca914d1b4b6f491ce121be617b3cd043fd92f413fce2311d2c8` |
| `docs/reviews/rc1-hosted-2026-10-14/case3-start.json` | `eed545f946d4dada57d86c94d095fbf8db3535baa07e163c1c5941f1e04a4f7e` | `a69c2afb0227af232c3c55d72fc5609be908e5f562f46be28024f8e8b7b6aae8` |
| `docs/reviews/rc1-hosted-2026-10-14/case4-result.json` | `517822c2de13aa17aaa923194fa0a736be8afd902da841ed3462b258fde78b6a` | `bc7110ee1fdea36ef1906ac9705536987960408d4193dcfbb317e024950a62e9` |
| `docs/reviews/rc1-hosted-2026-10-14/case4-start.json` | `34d40220a4defa8c507031e1bcdd6d04138e40afc5d310d50b5f30092dc57ba4` | `61eaa53b4d0b89ef42bb7be41832d8539ee057a24c949155d33c115c98e73898` |
| `docs/reviews/rc1-hosted-2026-10-14/case5-result.json` | `47101d5439e0d454c81c0d36b31073749bab81b79e3040952c2d046bfff367be` | `1599f2669a062e8db7d4704fd954bd02aa2f087ee01b32f3aab7538b501ccdf7` |
| `docs/reviews/rc1-hosted-2026-10-14/case5-start.json` | `8d9375e666dee5085e9e35e784642d7d3a2605a884c4ad82824a45491ab24850` | `d650a350397d8eb621e3963dede6215c2292a998c0a23a6ff5215f3700ebed99` |
| `docs/reviews/rc1-hosted-2026-10-14/case6-result.json` | `e6e220b8eb0519819acfd8782295c7953d67d993cdf7828e3024f7abd64b2866` | `19701cd3a2d241e0511caa3f009021ffb99643ac99deb407f79f2bc07573526a` |
| `docs/reviews/rc1-hosted-2026-10-14/case6-status.json` | `4bebbad9e33527665302aa6dcdc27cbfdae9b0abf8548001e823f6824df2952f` | `8b3f575e695473d87b9836c2fd33d7c8d9c89a8b7fc29bb1aa13ffde52baac61` |
| `docs/reviews/rc1-hosted-2026-10-14/case6/PREPARED.md` | `20951f26be4a6c1ec81521a94bbe9884c515504710cb13c900cebf97544b6f09` | `2688977100e73c0c21f2ad86fa065f81d83b21373a3ec7d4c424aa9d83bf8c27` |
| `docs/reviews/rc1-hosted-2026-10-14/final-readiness.json` | `e228f20a880372d5b0b163b0321e23676b41e3366584d670ae54fd05f69dcd9f` | `5c1037fbe45cbc409b968ffbe3840257d7785b7ff138a32c8870d376ac4fed12` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-CRLF-record.json` | `199643e3d0febf47040fcbcb5ba3508ed70ffe17545d0d612cc43966107c93f7` | `45f55bfef88214c9c122aff0f94355f9d5d1ec0acc25653145d1edc6ada9585d` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-absolute-filename.json` | `2bbba9bc08d83c595f9d6d4bd560e4f7c205817bde9617480de8abb22248b21a` | `55c8a3afe7f562d88f1007a17353f916b3df9f5c4b9b5a090f25faab49b803e2` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-corrupt-digest.json` | `955ef4c5fb4f2ce23c8cc3d0b29de2f1be08015cbd446af7299e06aada8f7f40` | `80c83210a6751fde35994f91a30da091b92334a4e497b27cc5f32c7bb5567c19` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-extra-blank-line.json` | `9583cff2335be1d94663067a66f0de294d44e774074033ea133051907901d601` | `c4d9b445a9873b2986cced83348167c21a40040de018dfa654e31480c5c3183a` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-extra-records.json` | `667feba62658cfc7ccc1a4a6afc4d4bc1fc604075e2dd12d52210973501e34ab` | `6289cd13b2b074007ec1038dc1e5315fa9757fac61bd2cc70a06b11848496996` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-malformed-digest-record.json` | `5adc436d446b39c2e26d86793b8ba0f67e9041108de988275f94030bf39e9cf1` | `3f354c351e35f53669cc6ded83868791aa11a136c2c2384405a765b38ca9d73f` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-missing-final-LF.json` | `cc0483b5043c263ec754be08091151f32833405d4779d6029fd2e7fca3cc95f5` | `eeb41810447a6e02b25319da5a2dc001cdaa32e579dbc52ace678e73509ac458` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-short-digest.json` | `57a690fe370ea5fee1c0a5235c877fe8b50f720d4aeaf46c2f2c9701cbe1c549` | `67cd14f993d132708cca32fcf7b6eb9dc05f6059688193b4e6c91df58b8c387c` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-traversal-filename.json` | `4b0f0849b3a0a1a52ad789680395006a68a18cd3918f8163e5c63a7bf6cb8fc3` | `3377d9bd761a1fc97a5ca9bd876c965d99836862761f363cda81f50d26515e13` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-uppercase-digest.json` | `9edefb393dec9c10ddbbbb19ac6c58fd164d5354c30caef3180e95dc3009b5c5` | `7476d0d74e19fb47eede1894e978e9d157bf1fce99ad35cc23c1f9af015dd8b1` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/checksum-wrong-release-basename.json` | `cff8a131458f9342c7f034dc5e4e44510cb323f99c2b456282accd497326881e` | `948aaf4cb7bc9782e20367fe80cfc41c6193f7d4c0b1495653aa274130eda8f6` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/independent-trailing-carriage-return.json` | `7de1d64bd92c3c92dd233fd7618f4ab00db3e77d344284aea4535fc205a7a334` | `e547b8573d9703ef8ff60349d3f3a30276d074270df88fb1a732400181c0f01b` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/independent-trailing-junk.json` | `0d1ff3580bb2144e96eec0a8d5667ebd434fce4602b11f6af77d97dee90cc4ad` | `b8b722a3fabc9e5969f45627eea7f9d11a41219b8076cdc2eb9ea37c7e89a920` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/invalid-format-matching-checksum.json` | `88d5fef283395f3678fff091ddc6121976143a4b856a0a7f28108e832d8a0290` | `3fbaca2e56c9e45a4e89c4ece971b5def65b4eba9f28940cc196041533d5a3ec` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/producer-format-success.json` | `7911fadacfbec52734cfa060fabdc111d0696843600319cf8ae37d8d39c6791d` | `0184a96179c20bacab42b9bd5163fcbcfd5de8331983da816f6e88cd530bbf44` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/provenance-mismatch.json` | `007c4a6cfcff645a904c8c897eee6d25e73ab83a7da5d8fff522c6dd56b4ee1f` | `653d2dde6552ef4c10c69b7c57e54d7aa5332a00ad426eeb18daf70eddf63192` |
| `docs/reviews/rc1-hosted-2026-10-14/positive-control/tampered-archive-original-checksum.json` | `6cc3b38b4c5c068e788f0dcec21f56d1768b0c226c95933b90eacba80bc7fc9f` | `4c7f8b68d0b062cb4f13a42ae2f8bd603afc9f31313b7474bd3bcb692a3036d9` |
| `docs/reviews/rc1-hosted-2026-10-14/proposed-followup.json` | `5c49a4c0d47e18568e095d45b903057d4f3d4b6378b87f5e92508646c4028cec` | `f380d47f4fb4c7d0234254b0211bd2af562fbd0b94fe13273dcb8ee5a735fa32` |
| `docs/reviews/rc1-integration-2026-10-14/REPORT.md` | `63b28721b397fddf1e00cfd0971831cca6f3a8094b978d1fc42a22281a567e11` | `9dbbed15118cec91c2cbad26933790006d7f3b599c6c038866c4987211e0e137` |
| `docs/reviews/rc1-integration-2026-10-14/fresh-account-kit-receipt.json` | `87c43aba70079b8330365a5fafbe695e2f2c518a4ab703b52ff1e1ff31a66416` | `8c006c64dca7c04991c45eccc240296fd9c58234fd73ad3192fc55b49eb69535` |
| `docs/reviews/site-project-release-gap-followup-2026-10-13/REPORT.md` | `9164f66599b51168a41443fc4cc7d1debe7cd4586d85feac7b928f512b94805e` | `6c0aee02bc3c33f7a0156aeaa9878cbbf4dcf65bcfb61f621b1b959520064339` |
| `docs/reviews/site-project-release-gap-followup-2026-10-13/inspect.py` | `41b5289fad20bc20ff2bed26a7a027205f56ad42164c5b0d3426cef2ce64ae35` | `5dce380107a2e7b8e8ca5a62ad12868ca49ed6e1d86f3ba86ad729bcddd848e3` |

## Manifests updated

Only the entries for rewritten files changed in each manifest.

| Path | Old SHA-256 | New SHA-256 |
| --- | --- | --- |
| `docs/history/reviews/rc28-target-test-2026-10-13/SHA256-MANIFEST.json` | `adbf3fc9ee0a66bc120b8794f02cc7642820e4407dea50c14ed0da47028cb5f6` | `fa4c5eac841d6e61228ce3de0c832fb0bdefe172fc0d378074be14551017a65c` |
| `docs/history/reviews/v1-confirmation-2026-10-13/SHA256-MANIFEST.json` | `f61b1ee1ad26196eb59b98c8c9c496e3091da36dddb10f0a3b31f16a694f805b` | `496c705bd5c4e09e463dd778b4804463f79199998b9b09f5c550e773a9d2b9e6` |
| `docs/reviews/practical-tool-fix-2026-10-13/SHA256-MANIFEST.json` | `e1b9d2e3afdb305cb0cb22763a6adabb420453bee1943b1cd88ec07fe7529714` | `f395a9df25d20f049e875a93a4e5d76175909939182fc3450bee153323985ea5` |
| `docs/reviews/practical-tool-fix-2026-10-13/performance/SHA256-MANIFEST.json` | `8de892d3364133aa3d3f308c6dde238ea34cab19e790bdfe72df872b66fa3e73` | `b1886583a0d850488c19926bcf00cdacb8b9ec3433f46c728eea8328c1dc02fb` |
| `docs/reviews/rc1-hosted-2026-10-14/SHA256-MANIFEST.json` | `e67c83ff3210a59369887f2dc5344431d2c2b0d836c4e7231deb9e45405aee32` | `447bc78b4d31ebba5f7732b04a1c2cd58e3ff6c4e4e2a79f21b4e4ba3415731d` |
| `docs/reviews/rc1-integration-2026-10-14/SHA256-MANIFEST.json` | `6540e5fad256ca51eb7195182c2fde64c658b3bae08d783251dd89d55db01512` | `bea2ee8c8e575ce6cf1d46a0b263ec1539b8f3f35050e1decc71f7b7c2e85264` |

## Raw files left unredacted

These files still contain a home path or the project name. Their bytes are the evidence, or their hash is recorded in another file.

| Path | Contains | Reason |
| --- | --- | --- |
| `docs/reviews/practical-tool-access-1.0.1-rc.1-manifest.json` | path | its SHA-256 is recorded in `docs/reviews/rc1-integration-2026-10-14/integration-preview.json` |
| `docs/reviews/practical-tool-access-2026-10-13-manifest.json` | path | its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/rc1-installed-files.json`, `docs/reviews/practical-tool-fix-2026-10-13/rc1-package-audit.json`, `docs/reviews/rc1-integration-2026-10-14/integration-preview.json` and others |
| `docs/reviews/practical-tool-access-2026-10-13.md` | path | its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/rc1-installed-files.json`, `docs/reviews/practical-tool-fix-2026-10-13/rc1-package-audit.json`, `docs/reviews/rc1-integration-2026-10-14/integration-preview.json` and others |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-1.0.1-rc1-package-frozen.log` | path | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/practical-tool-access-1.0.1-rc.1-manifest.json`, `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-access-1.0.1-rc.1-manifest.json`, `docs/reviews/rc1-integration-2026-10-14/complete-source.patch` and others |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-access-1.0.1-rc.1-manifest.json` | path | its SHA-256 is recorded in `docs/reviews/rc1-integration-2026-10-14/integration-preview.json` |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-access-2026-10-13-manifest.json` | path | its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/rc1-installed-files.json`, `docs/reviews/practical-tool-fix-2026-10-13/rc1-package-audit.json`, `docs/reviews/rc1-integration-2026-10-14/integration-preview.json` and others |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-access-2026-10-13.md` | path | its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/rc1-installed-files.json`, `docs/reviews/practical-tool-fix-2026-10-13/rc1-package-audit.json`, `docs/reviews/rc1-integration-2026-10-14/integration-preview.json` and others |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-rc1-node20-symlink-attempt.log` | path | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/rc1-node20-supplement.json` |
| `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-rc1-node20-verify.log` | path | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/rc1-node20-supplement.json` |
| `docs/reviews/practical-tool-fix-2026-10-13/proposed-hosted-assignments.json` | path and name | its SHA-256 is recorded in `docs/reviews/practical-tool-fix-2026-10-13/RC1-RESUME.json` |
| `docs/reviews/practical-tool-fix-2026-10-13/verify-release.log` | path | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/practical-tool-access-2026-10-13-manifest.json`, `docs/reviews/practical-tool-fix-2026-10-13/REPORT.md`, `docs/reviews/practical-tool-fix-2026-10-13/practical-tool-access-2026-10-13-manifest.json` and others |
| `docs/reviews/rc1-hosted-2026-10-14/case2/diff.patch` | name | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case2-acceptance.json`, `docs/reviews/rc1-hosted-2026-10-14/case2-result.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/events.ndjson` | name | raw event or log stream format; its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case2-result.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-original.log` | path and name | marked `-text` in `.gitattributes` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/independent-edge.log` | name | marked `-text` in `.gitattributes` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/independent-verifier.test.ts.txt` | name | its SHA-256 is recorded in `docs/reviews/rc1-integration-2026-10-14/ci-consolidation-correction.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case2/transcript.md` | name | its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case2-result.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/diff.patch` | name | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case2b-acceptance.json`, `docs/reviews/rc1-hosted-2026-10-14/case2b-result.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/events.ndjson` | name | raw event or log stream format; its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case2b-result.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case2b/transcript.md` | name | its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case2b-result.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case6/case6-official-client.json` | path | its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case6/helper-author-audit.json`, `docs/reviews/rc1-hosted-2026-10-14/case6/post-exit-verification.json` |
| `docs/reviews/rc1-hosted-2026-10-14/case6/observer-snapshot.jsonl` | path | raw event or log stream format; its SHA-256 is recorded in `docs/reviews/rc1-hosted-2026-10-14/case6/post-exit-verification.json` |
| `docs/reviews/rc1-integration-2026-10-14/complete-source.patch` | path | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/rc1-integration-2026-10-14/rollback-verification.json` |
| `docs/reviews/rc1-integration-2026-10-14/rollback.patch` | path | marked `-text` in `.gitattributes`; its SHA-256 is recorded in `docs/reviews/rc1-integration-2026-10-14/rollback-verification.json` |
| `docs/reviews/site-project-release-gap-followup-2026-10-13/evidence.json` | name | its SHA-256 is recorded in `docs/reviews/site-project-release-gap-followup-2026-10-13/REPORT.md` |

## Embedded hashes that describe pre-redaction text

The files below were rewritten, but a hash recorded inside them was computed over the text before redaction. The hash fields were not edited. To verify one, reverse the placeholder substitution in the string it covers.

- `command` strings with `commandSha256` and `commandBytes` in fixture result files:
  - `docs/reviews/rc1-hosted-2026-10-14/case2/fixtures-verified/`: 15 files
  - `docs/reviews/rc1-hosted-2026-10-14/case2/independent-edge-fixtures/`: 2 files
  - `docs/reviews/rc1-hosted-2026-10-14/case2b/fixtures/`: 17 files
  - `docs/reviews/rc1-hosted-2026-10-14/positive-control/`: 17 files
- `docs/reviews/rc1-hosted-2026-10-14/case2-result.json`: the `transcript` string is a copy of the raw transcript file listed above, redacted. The artifact hash in the same file still matches the raw transcript file, which was left unchanged.
- `docs/reviews/rc1-hosted-2026-10-14/case2b-result.json`: the `transcript` string is a copy of the raw transcript file listed above, redacted. The artifact hash in the same file still matches the raw transcript file, which was left unchanged.

## Other scope notes

- The handoff document and the usefulness log contain no machine paths and no project name, so they were not changed.
