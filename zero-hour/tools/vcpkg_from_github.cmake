# Drop-in replacement for vcpkg's scripts/cmake/vcpkg_from_github.cmake.
# Fetches sources with `git fetch` instead of downloading a GitHub tarball, for
# build machines whose proxy allows git reads of github.com but not archive
# downloads. The tarball SHA512 is not checked; the commit SHA is.
function(vcpkg_from_github)
    cmake_parse_arguments(PARSE_ARGV 0 "arg"
        "USE_TARBALL_API"
        "OUT_SOURCE_PATH;REPO;REF;SHA512;HEAD_REF;GITHUB_HOST;AUTHORIZATION_TOKEN;FILE_DISAMBIGUATOR"
        "PATCHES")
    if(NOT DEFINED arg_OUT_SOURCE_PATH OR NOT DEFINED arg_REPO OR NOT DEFINED arg_REF)
        message(FATAL_ERROR "vcpkg_from_github (git variant) needs OUT_SOURCE_PATH, REPO and REF")
    endif()
    if(NOT DEFINED arg_GITHUB_HOST)
        set(arg_GITHUB_HOST "https://github.com")
    endif()
    set(url "${arg_GITHUB_HOST}/${arg_REPO}")

    set(extra "")
    string(LENGTH "${arg_REF}" ref_length)
    if(ref_length EQUAL 40 AND arg_REF MATCHES "^[0-9a-f]+$")
        set(commit "${arg_REF}")
    else()
        find_program(GIT git REQUIRED)
        execute_process(
            COMMAND "${GIT}" ls-remote "${url}" "${arg_REF}" "${arg_REF}^{}"
            OUTPUT_VARIABLE refs RESULT_VARIABLE rc OUTPUT_STRIP_TRAILING_WHITESPACE)
        if(NOT rc EQUAL 0 OR refs STREQUAL "")
            message(FATAL_ERROR "Could not resolve ${arg_REF} in ${url}")
        endif()
        # Prefer the peeled commit of an annotated tag (listed last, as ref^{}).
        string(REGEX MATCHALL "[0-9a-f]+\t[^\n]+" lines "${refs}")
        list(GET lines -1 last)
        string(REGEX REPLACE "\t.*" "" commit "${last}")
        string(REGEX REPLACE "^[0-9a-f]+\t" "" fetch_ref "${last}")
        string(REGEX REPLACE "\\^{}$" "" fetch_ref "${fetch_ref}")
        set(extra FETCH_REF "${fetch_ref}")
    endif()

    vcpkg_from_git(
        OUT_SOURCE_PATH source_path
        URL "${url}"
        REF "${commit}"
        ${extra}
        PATCHES ${arg_PATCHES})
    set("${arg_OUT_SOURCE_PATH}" "${source_path}" PARENT_SCOPE)
endfunction()
