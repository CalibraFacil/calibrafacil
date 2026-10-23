# Changelog

Every release of Calibra Fácil, newest first. Entries are written by
[release-please](https://github.com/googleapis/release-please) from the
[Conventional Commits](https://www.conventionalcommits.org/) merged to `main`; see
[`DEPLOYMENT.md`](./DEPLOYMENT.md#updating) before updating an instance.

## [0.3.0](https://github.com/CalibraFacil/calibrafacil/compare/v0.2.0...v0.3.0) (2026-10-23)


### Features

* **api:** typed domain errors with stable codes, mapped once ([#70](https://github.com/CalibraFacil/calibrafacil/issues/70)) ([25649d6](https://github.com/CalibraFacil/calibrafacil/commit/25649d62a6bf8b9d247455dae157558173bf088a))
* **certificates:** freeze certificate_input at approval; the worker renders only from it (P2-5) ([#96](https://github.com/CalibraFacil/calibrafacil/issues/96)) ([0f9462e](https://github.com/CalibraFacil/calibrafacil/commit/0f9462e5390d108163abc5d611b9ba39d6b12ead))
* **config:** one validated configuration module per runtime, failing fast at start-up ([#82](https://github.com/CalibraFacil/calibrafacil/issues/82)) ([00b266d](https://github.com/CalibraFacil/calibrafacil/commit/00b266d97a7bee98d919afaa3a4207f60301ff8f))
* **contracts:** typed contracts for standards, limits, job create, the portal and desktop parity (P2-15) ([#95](https://github.com/CalibraFacil/calibrafacil/issues/95)) ([12d4bfa](https://github.com/CalibraFacil/calibrafacil/commit/12d4bfa06bf02afee0ce4a5f9956bd4ee54b20b3))
* **db:** database-level guard on calibration_job status transitions, generated from JOB_TRANSITIONS (P2-6) ([#94](https://github.com/CalibraFacil/calibrafacil/issues/94)) ([169fc63](https://github.com/CalibraFacil/calibrafacil/commit/169fc6394bbade1b5310849f6e0fef19b8991ab9))
* **db:** freeze approved jobs and make evidence append-only in Postgres ([ec10e30](https://github.com/CalibraFacil/calibrafacil/commit/ec10e30fa354ddfd2248b9c1844779ca1575300b))
* **db:** freeze approved jobs and make evidence append-only in Postgres ([bd59caf](https://github.com/CalibraFacil/calibrafacil/commit/bd59caf857e4c2ff0d42955e64420b4d9aa24c7c))
* **db:** org-bound forOrg handle, raw-db ratchet in routes, portal fully migrated (P2-2 slice 1) ([#98](https://github.com/CalibraFacil/calibrafacil/issues/98)) ([2737c22](https://github.com/CalibraFacil/calibrafacil/commit/2737c22a2bf78f86cdb2123c8f94e9314da7cada))
* **db:** organization_id on every tenant table with composite tenant keys (P2-1) ([#87](https://github.com/CalibraFacil/calibrafacil/issues/87)) ([137bf2a](https://github.com/CalibraFacil/calibrafacil/commit/137bf2a1cdedf370bddd604983b66d6266892fa2))
* **db:** row-level security in shadow mode for a calibra_app role; owner unaffected (P2-3) ([#105](https://github.com/CalibraFacil/calibrafacil/issues/105)) ([8678e16](https://github.com/CalibraFacil/calibrafacil/commit/8678e1616d7ce8c0949205bda315f51cc20ca536))
* **desktop:** enforce calibration location and phase justification at submit offline and at sync (P1-12) ([#93](https://github.com/CalibraFacil/calibrafacil/issues/93)) ([298a8a1](https://github.com/CalibraFacil/calibrafacil/commit/298a8a1e835873df4f629f6e5f2def5f54fb8261))
* **jobs:** draft saves keep a saved standard that went stale, with a warning; submit stays the gate (P1-11) ([#92](https://github.com/CalibraFacil/calibrafacil/issues/92)) ([fbd5220](https://github.com/CalibraFacil/calibrafacil/commit/fbd5220974fb5f2c04e6e32e346ca325151ec195))
* **jobs:** one submit/execute command for cloud, public API and desktop sync ([#81](https://github.com/CalibraFacil/calibrafacil/issues/81)) ([469d56a](https://github.com/CalibraFacil/calibrafacil/commit/469d56ac6794c1142793981128376a7e2d21d4d1))
* **jobs:** reject, cancel, assign, edit and amend as commands; no route writes jobs directly ([#83](https://github.com/CalibraFacil/calibrafacil/issues/83)) ([fc37bd8](https://github.com/CalibraFacil/calibrafacil/commit/fc37bd803f222042a4a9d50c4fa1a03a4ff9bb45))
* **math-engine:** pin the engine version to a source hash and reproduce the EA-4/02 examples ([db54bde](https://github.com/CalibraFacil/calibrafacil/commit/db54bde0f687ed6b69c59a355bc09d8c32a31508))
* **math-engine:** pin the engine version to a source hash and reproduce the EA-4/02 examples ([4187712](https://github.com/CalibraFacil/calibrafacil/commit/4187712b536559262513e29576fca360351c1ac6))
* retain regulated records (no cascade into evidence, soft-deleted labs, retention policy, purge job off by default) ([#75](https://github.com/CalibraFacil/calibrafacil/issues/75)) ([a2c34b2](https://github.com/CalibraFacil/calibrafacil/commit/a2c34b2c8745be23dab52f16b8214ddab113c69c))
* **rls:** client portal runs in org-scoped transactions (P2-18a) ([#110](https://github.com/CalibraFacil/calibrafacil/issues/110)) ([e326716](https://github.com/CalibraFacil/calibrafacil/commit/e326716e60eb2de4a2a8591508d33ea573fa51e1))
* **rls:** master data runs in org-scoped transactions (P2-18c) ([#112](https://github.com/CalibraFacil/calibrafacil/issues/112)) ([026e4ad](https://github.com/CalibraFacil/calibrafacil/commit/026e4ad79d01259c0a858315b8bec9d88c38aed7))
* **rls:** NC/CAPA, dashboard, reports and signing run in org-scoped transactions (P2-18e) ([#115](https://github.com/CalibraFacil/calibrafacil/issues/115)) ([5de7cb1](https://github.com/CalibraFacil/calibrafacil/commit/5de7cb17d52ea4d1007235f19210fee4eb629c4b))
* **rls:** quality records run in org-scoped transactions (P2-18d) ([#113](https://github.com/CalibraFacil/calibrafacil/issues/113)) ([2dd8128](https://github.com/CalibraFacil/calibrafacil/commit/2dd81289a8adf727cbcd0badff9ad74cee0864df))
* **rls:** service orders and finance run in org-scoped transactions (P2-18g) ([#114](https://github.com/CalibraFacil/calibrafacil/issues/114)) ([ee802b7](https://github.com/CalibraFacil/calibrafacil/commit/ee802b7b7bd1027bf21f9b868a11977a26af99c7))
* **sync:** commit-ordered change log with tombstones and a paged resumable bootstrap (P2-4b) ([#104](https://github.com/CalibraFacil/calibrafacil/issues/104)) ([479d7b0](https://github.com/CalibraFacil/calibrafacil/commit/479d7b0fca013c25698d284c50e254e43b7b659e))
* **sync:** typed versioned protocol, one transaction per event, stale-base conflicts, minimum desktop version (P2-4a) ([#99](https://github.com/CalibraFacil/calibrafacil/issues/99)) ([881c9f8](https://github.com/CalibraFacil/calibrafacil/commit/881c9f8f51983d75b41f63e5d4795c6208b5acca))
* typed and validated API contracts for jobs and the portal overview ([#79](https://github.com/CalibraFacil/calibrafacil/issues/79)) ([1a8346b](https://github.com/CalibraFacil/calibrafacil/commit/1a8346b8696066cd099950a8867f35a5a65c6c2c))
* **web,portal:** route error boundaries, a parallel portal startup and stable paginated lists ([#69](https://github.com/CalibraFacil/calibrafacil/issues/69)) ([d80d3bd](https://github.com/CalibraFacil/calibrafacil/commit/d80d3bdc80e3f6abfd924a74828b512a1609ced0))


### Bug fixes

* **api:** check request-supplied ids against the caller's organization ([2506827](https://github.com/CalibraFacil/calibrafacil/commit/25068276604a346f35e6af43b287bfedff49ba26))
* **api:** check request-supplied ids against the caller's organization ([56d672e](https://github.com/CalibraFacil/calibrafacil/commit/56d672ea63dec8dcb1fc34e396fab848a8698d08))
* **api:** guard every job status change with a compare-and-set ([fe311b7](https://github.com/CalibraFacil/calibrafacil/commit/fe311b79a38fec5649ea813c565dc497c8b27803))
* **api:** guard every job status change with a compare-and-set ([a953d77](https://github.com/CalibraFacil/calibrafacil/commit/a953d770ec9e515d7c894a95e5cf5519ae1c1296))
* **api:** require the organization admin to change certificate numbering and the scope guard ([59762f6](https://github.com/CalibraFacil/calibrafacil/commit/59762f61cbe8b2715ab2f48e1ff67520c0d1f388))
* **api:** require the organization admin to change certificate numbering and the scope guard ([f434726](https://github.com/CalibraFacil/calibrafacil/commit/f434726762aa28cfa4e72f5eb8c02bb53e078f16))
* **api:** send every approval through one approveJob policy ([31c0109](https://github.com/CalibraFacil/calibrafacil/commit/31c0109788c53c187125bfb5f811e42b3dea237d))
* **api:** send every approval through one approveJob policy ([b9c0726](https://github.com/CalibraFacil/calibrafacil/commit/b9c0726fa1b5933fc0a41d51bb6f395a3b59ed6c))
* cash forecast counts order-less documents, quote PDF route, first-click OOT ack in the app (Q34–Q36) ([#116](https://github.com/CalibraFacil/calibrafacil/issues/116)) ([a584d20](https://github.com/CalibraFacil/calibrafacil/commit/a584d209623e89bd66f562e6a4d640d0e3a4883c))
* **deps:** electron 42.11.18 and vitest 4.1.12 for the open Dependabot alerts ([#108](https://github.com/CalibraFacil/calibrafacil/issues/108)) ([c59be79](https://github.com/CalibraFacil/calibrafacil/commit/c59be79592abce4d12f5c984b2e4e9e42575d7b4))
* **deps:** next 16.4.2 for the critical RCE advisories (GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr) ([#97](https://github.com/CalibraFacil/calibrafacil/issues/97)) ([fe8f7ea](https://github.com/CalibraFacil/calibrafacil/commit/fe8f7ea80e3714c12c99aa7407005b4cf4b7d992))
* **deps:** patch vite, launch-editor and http-cache-semantics advisories ([fa09389](https://github.com/CalibraFacil/calibrafacil/commit/fa093898889df58eb23684605e7f458976665d47))
* **deps:** patch vite, launch-editor and http-cache-semantics advisories ([8f27686](https://github.com/CalibraFacil/calibrafacil/commit/8f27686cda457c21b8e3ebb5673eee35328beb34))
* **desktop:** permanently refused outbox events leave the push queue instead of starving it ([#86](https://github.com/CalibraFacil/calibrafacil/issues/86)) ([6e8f44a](https://github.com/CalibraFacil/calibrafacil/commit/6e8f44a36653f05f61661ae05eadccaf3dc24c7a))
* **portal:** scope the query cache to the active client organization ([#63](https://github.com/CalibraFacil/calibrafacil/issues/63)) ([5d0de43](https://github.com/CalibraFacil/calibrafacil/commit/5d0de435366b2afdc705463f29f274accf292fd2))
* **queue:** dead-letter crashed jobs and reject certificates stuck in generation ([#61](https://github.com/CalibraFacil/calibrafacil/issues/61)) ([d6a470e](https://github.com/CalibraFacil/calibrafacil/commit/d6a470ee398eadd5d5cb64b6a509926697e4d463))
* **queue:** fence job settlement by lease and enforce receipts by default ([#65](https://github.com/CalibraFacil/calibrafacil/issues/65)) ([0cdec29](https://github.com/CalibraFacil/calibrafacil/commit/0cdec29e62182cd744222522ba633e379af8b6fc))
* remove the path that published desktop-rendered PDFs as issued certificates ([#68](https://github.com/CalibraFacil/calibrafacil/issues/68)) ([ad686b5](https://github.com/CalibraFacil/calibrafacil/commit/ad686b5ca53b96ec3a737abc794d7ef4fc8bf987))
* show calendar dates as São Paulo days across web, portal, API and PDFs ([a62e982](https://github.com/CalibraFacil/calibrafacil/commit/a62e98257b65483f133f9120924b85639c35bf1b))
* show calendar dates as São Paulo days across web, portal, API and PDFs ([296ade1](https://github.com/CalibraFacil/calibrafacil/commit/296ade114096ae60a923afeae7a7354659eb2efc))
* **signing:** configured RFC 3161 time-stamping reaches the worker on every path ([#84](https://github.com/CalibraFacil/calibrafacil/issues/84)) ([6da73b0](https://github.com/CalibraFacil/calibrafacil/commit/6da73b0c218441895c413add1167c6df937f1703))
* store calendar dates as Postgres dates and judge standards on the performed day ([#62](https://github.com/CalibraFacil/calibrafacil/issues/62)) ([8c9d8ac](https://github.com/CalibraFacil/calibrafacil/commit/8c9d8ac4b65f36693add9c1a37ab58fe5489fa94))
* **sync:** stop the pull cursor skipping rows and reject unknown operations ([f62542d](https://github.com/CalibraFacil/calibrafacil/commit/f62542d6b3bafe5467fbef519f7136bc6f8ed4da))
* **sync:** stop the pull cursor skipping rows and reject unknown operations ([e3a66a9](https://github.com/CalibraFacil/calibrafacil/commit/e3a66a9623abc45fe410c18a14f2bb5af90a6689))
* **web:** protect unsaved readings on the calibration execution page ([#67](https://github.com/CalibraFacil/calibrafacil/issues/67)) ([7ee79a4](https://github.com/CalibraFacil/calibrafacil/commit/7ee79a4e3f1acae3fe8ad2e916b865da203fa272))
* **web:** read expiry and report-month dates in the lab's time zone ([0bef642](https://github.com/CalibraFacil/calibrafacil/commit/0bef64242543ca914bcbb06e0fc6d57b9775880e))
* **web:** read expiry and report-month dates in the lab's time zone ([0325c3d](https://github.com/CalibraFacil/calibrafacil/commit/0325c3d8f31ea3b8b53ac46be0e461afd7fcab85))


### Performance

* split the web/portal bundles and budget the initial graph ([#64](https://github.com/CalibraFacil/calibrafacil/issues/64)) ([2df8ee1](https://github.com/CalibraFacil/calibrafacil/commit/2df8ee116b7d83b9dd29544a18751895ba17eda5))

## [0.2.0](https://github.com/CalibraFacil/calibrafacil/compare/v0.1.1...v0.2.0) (2026-10-07)


### Features

* connect Conta Azul with the laboratory's own application ([#40](https://github.com/CalibraFacil/calibrafacil/issues/40)) ([cb53d5f](https://github.com/CalibraFacil/calibrafacil/commit/cb53d5fe9c50e3145e3f480420620ddd87d8ad65))


### Bug fixes

* **deps:** remove the packages behind the open security alerts ([#41](https://github.com/CalibraFacil/calibrafacil/issues/41)) ([181f04a](https://github.com/CalibraFacil/calibrafacil/commit/181f04ab2be8f3ad8d692a9bd208f8ae6ee8f084))

## [0.1.1](https://github.com/CalibraFacil/calibrafacil/compare/v0.1.0...v0.1.1) (2026-10-07)


### Bug fixes

* **deps:** patch the open security advisories ([#36](https://github.com/CalibraFacil/calibrafacil/issues/36)) ([4a96999](https://github.com/CalibraFacil/calibrafacil/commit/4a969993e43b8baf082c356410a42d418485523f))
* **desktop:** name the repository for the update feed ([b9822f6](https://github.com/CalibraFacil/calibrafacil/commit/b9822f697199b57c565de5f4bdb8ee8bd7143a93))

## 0.1.0 (2026-10-07)


### Features

* **api:** add init and create-lab commands for new installs ([d4fd317](https://github.com/CalibraFacil/calibrafacil/commit/d4fd317819a5a877d33912dbbb82b35cce1f4f1c))
* **api:** fill the demo laboratory with sample work ([4f6307c](https://github.com/CalibraFacil/calibrafacil/commit/4f6307c5e7e8b0deefcf6966aca037f20337ab8d))
* **api:** let the demo customers sign in to the portal ([88aa445](https://github.com/CalibraFacil/calibrafacil/commit/88aa4456af1501d54e99182fb7e2440b1512ed53))
* **api:** run the scheduled jobs in-process with CRON_SCHEDULER=internal ([ee5a3f4](https://github.com/CalibraFacil/calibrafacil/commit/ee5a3f4d6609ee5a9845705c1ff2e82b79aa9f22))
* **deploy:** self-host on one server with Docker Compose ([80889b6](https://github.com/CalibraFacil/calibrafacil/commit/80889b6d112b2a846880e869afa74a91ae05e2b4))
* **email:** send over SMTP as well as the Resend API ([7cf7193](https://github.com/CalibraFacil/calibrafacil/commit/7cf7193b7da1747aceddb661d77f969126ef80f8))
* **site:** show the whole dashboard in a lit, nested frame ([cead574](https://github.com/CalibraFacil/calibrafacil/commit/cead57452fb2b96f87092e18b3a97de57cee0713))
* **web,portal:** read deployment settings when the image starts ([3339faa](https://github.com/CalibraFacil/calibrafacil/commit/3339faa466d8e2527cea0a15647fe9745931199a))
* **web:** point new labs at the right controls with a guided tour ([e0c2035](https://github.com/CalibraFacil/calibrafacil/commit/e0c203568a8a62c2eb3cb59f258d13df18207f40))


### Bug fixes

* **deps:** patch the seroval, sharp and source-map-js advisories ([917f00c](https://github.com/CalibraFacil/calibrafacil/commit/917f00cf43eeb349c9aba90b269de47c9a187ea6))
* **desktop:** build the usb module with C++17 ([01070ce](https://github.com/CalibraFacil/calibrafacil/commit/01070ce4f2e31e399221c95aba68209060f49928))
* **documents:** render document titles as a single string ([ba50561](https://github.com/CalibraFacil/calibrafacil/commit/ba50561080f87a6b8ee7590a24242f0e921de7df))
* **web,portal,docs:** stop loading Vercel Analytics ([5639475](https://github.com/CalibraFacil/calibrafacil/commit/5639475444902504554eec05b6e633ba7e4a65e6))


### Documentation

* **contributing:** mention the dev container, CI tiers and releases ([852cb63](https://github.com/CalibraFacil/calibrafacil/commit/852cb639b72eca91bc5a6d778b58e094f1e63382))
* publish the documentation at calibrafacil.com/docs ([b5df65f](https://github.com/CalibraFacil/calibrafacil/commit/b5df65f15642387f070ffc9d5c78503684d342ff))
* start the changelog that release-please fills ([39c8c8e](https://github.com/CalibraFacil/calibrafacil/commit/39c8c8e1d4c1ebf0310693f6824511c5b769e202))
