(ns no-deceit.purity-test
  (:require [babashka.fs :as fs]
            [clojure.test :refer [deftest is]]
            [no-deceit.purity :as p]))

(defn- lint-src [src]
  (let [dir (fs/create-temp-dir)]
    (try
      (spit (str (fs/path dir "x.clj")) src)
      (vec (p/violations (str dir)))
      (finally (fs/delete-tree dir)))))

(deftest pure-ns-passes
  (is (= [] (lint-src (str "(ns no-deceit.x \"uses babashka.fs? no\"\n"
                           "  (:require [clojure [string :as str]] [no-deceit.y :as y]))\n"
                           ";; (slurp \"f\") System/getenv\n"
                           "(comment (slurp \"x.json\"))\n"
                           "(defn f [m] (str/upper-case (:k m)) (Math/abs -1) (.trim \" a \"))")))))

(deftest impure-requires-fail
  (doseq [req ["babashka.fs" "[babashka [fs :as fs]]" "[babashka fs]"
               "[clojure.java.shell :as sh]" "clojure.java.io"]]
    (is (seq (lint-src (str "(ns x (:require " req "))"))) req))
  (is (seq (lint-src "(ns x (:import (java.time Instant)))"))))

(deftest impure-calls-fail
  (doseq [call ["(slurp \"f\")" "(spit \"f\" 1)" "(clojure.core/slurp \"f\")"
                "(System/getenv \"X\")" "(System/getProperty \"x\")"
                "(System/currentTimeMillis)" "(java.time.Instant/now)"
                "(java.io.File. \"f\")" "(clojure.java.io/file \"f\")"
                "(babashka.fs/exists? \"f\")" "(. System getenv)"]]
    (is (seq (lint-src (str "(ns x)\n(defn f [] " call ")"))) call)))
