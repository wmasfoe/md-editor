// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "Inkpoint",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "InkpointCore",
            targets: ["InkpointCore"]
        ),
        .executable(
            name: "InkpointContractTests",
            targets: ["InkpointContractTests"]
        )
    ],
    targets: [
        .target(
            name: "InkpointCore",
            path: "Sources/InkpointCore"
        ),
        .executableTarget(
            name: "InkpointContractTests",
            dependencies: ["InkpointCore"],
            path: "Tests/InkpointContractTests"
        )
    ]
)
